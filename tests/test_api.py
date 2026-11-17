import base64
import io
import tempfile
import time
import unittest
import threading
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
from promptscope.app import create_app
from promptscope.detector import GroundingDetector
from promptscope.experiments import Experiments


class FakeDetector(GroundingDetector):
    """CI fixture, never used by the application itself."""
    calls=0
    def status(self): return {"installed":True,"loaded":None,"state":"idle"}
    def predict(self,image,prompt,variant,text_threshold,progress=lambda _:None):
        self.calls+=1
        return {"detections":[{"box":[.1,.1,.8,.8],"score":.8,"label":"person"}],"elapsed_ms":1}


class APITests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.detector=FakeDetector()
        self.app=create_app(self.tmp.name,self.detector)
        self.client=TestClient(self.app)
        self.client.__enter__()
        self.headers={"X-PromptScope":"1"}
        self.image=self.upload()

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.tmp.cleanup()

    def post(self,path,body): return self.client.post(path,json=body,headers=self.headers)

    def upload(self,color="red"):
        f=io.BytesIO();Image.new("RGB",(20,20),color).save(f,format="PNG")
        response=self.post("/api/images",{"name":"test.png","data":base64.b64encode(f.getvalue()).decode()})
        self.assertEqual(response.status_code,200)
        return response.json()

    def wait_job(self,identifier):
        for _ in range(100):
            j=self.client.get("/api/jobs/"+identifier).json()
            if j["status"] not in ("queued","running"): return j
            time.sleep(.01)
        self.fail("job timeout")

    def test_upload_deduplicates_and_serves_normalized_image(self):
        self.assertEqual(self.upload()["id"],self.image["id"])
        self.assertEqual(self.client.get(f"/api/images/{self.image['id']}/file").headers["content-type"],"image/png")

    def test_write_header_origin_and_host(self):
        self.assertEqual(self.client.post("/api/sample",json={}).status_code,403)
        r=self.client.post("/api/sample",json={},headers={**self.headers,"Origin":"https://evil.example"})
        self.assertEqual(r.status_code,403)
        self.assertEqual(self.client.get("/api/status",headers={"Host":"evil.example"}).status_code,400)

    def test_bad_upload_and_import(self):
        self.assertEqual(self.client.post("/api/images",content=b"{invalid",headers=self.headers).status_code,422)
        self.assertEqual(self.post("/api/images",{"data":"!!invalid"}).status_code,422)
        self.assertEqual(self.post("/api/images",{"data":base64.b64encode(b"not image").decode()}).status_code,400)
        body={"image_id":self.image["id"],"prompt":"person.","detections":[{"label":"person","score":.8,"box":[1,1,0,0]}]}
        self.assertEqual(self.post("/api/runs/import",body).status_code,422)

    def test_inference_cache_and_persistence(self):
        req={"image_id":self.image["id"],"prompts":["person.","astronaut."]}
        j=self.wait_job(self.post("/api/jobs",req).json()["id"])
        self.assertEqual(j["status"],"complete")
        self.assertEqual(len(j["run_ids"]),2)
        again=self.wait_job(self.post("/api/jobs",req).json()["id"])
        self.assertEqual(again["run_ids"],j["run_ids"])
        self.assertEqual(self.detector.calls,2)
        self.assertEqual(len(self.client.get("/api/runs").json()),2)

    def test_missing_image_and_cross_image_comparison(self):
        self.assertEqual(self.post("/api/jobs",{"image_id":"f"*32,"prompts":["cat"]}).status_code,404)
        second=self.upload("blue")
        ids=[]
        for image in (self.image,second):
            ids.append(self.post("/api/runs/import",{"image_id":image["id"],"prompt":"person","detections":[]}).json()["id"])
        self.assertEqual(self.post("/api/compare",{"run_a":ids[0],"run_b":ids[1]}).status_code,422)

    def test_agent_executes_stored_plan_not_client_prompts(self):
        plan=self.post("/api/agent/plan",{"goal":"compare prompts","target":"person","mode":"template"}).json()
        req={"image_id":self.image["id"],"prompts":["ignored"]}
        j=self.wait_job(self.post("/api/agent/execute/"+plan["id"],req).json()["id"])
        self.assertEqual(j["status"],"complete")
        self.assertEqual(len(j["run_ids"]),3)
        self.assertEqual(j["request"]["prompts"][0],"person.")
        self.assertEqual(j["report"]["source"],"deterministic")

    def test_failed_model_is_explicit_not_fabricated(self):
        with patch.object(self.detector,"predict",side_effect=RuntimeError("no weights")):
            j=self.wait_job(self.post("/api/jobs",{"image_id":self.image["id"],"prompts":["person"]}).json()["id"])
        self.assertEqual(j["status"],"failed")
        self.assertEqual(j["run_ids"],[])

    def test_llm_invalid_plan_never_executes(self):
        with patch("promptscope.agent.llm_json",return_value={"goal":"x","experiments":[],"caveat":"x"}):
            r=self.post("/api/agent/plan",{"goal":"test","target":"person","mode":"llm"})
        self.assertEqual(r.status_code,422)
        self.assertEqual(self.detector.calls,0)

    def test_evaluation_endpoint(self):
        r=self.post("/api/runs/import",{"image_id":self.image["id"],"prompt":"person","detections":[{"label":"person","score":.9,"box":[.1,.1,.8,.8]}]}).json()
        result=self.post("/api/evaluate",{"run_id":r["id"],"ground_truth":[{"label":"person","box":[.1,.1,.8,.8]}]}).json()
        self.assertEqual(result["map"],1)

    def test_repeated_cached_detection_creates_distinct_groups(self):
        req={"image_id":self.image["id"],"prompts":["person."]}
        a=self.wait_job(self.post("/api/jobs",req).json()["id"])
        b=self.wait_job(self.post("/api/jobs",req).json()["id"])
        self.assertNotEqual(a["id"],b["id"])
        self.assertEqual(a["run_ids"],b["run_ids"])
        groups=self.client.get("/api/experiments").json()
        self.assertEqual(len(groups),2)
        self.assertTrue(all(g["mode"]=="manual" for g in groups))

    def test_manual_and_agent_groups_keep_their_image_and_runs(self):
        a=self.wait_job(self.post("/api/jobs",{"image_id":self.image["id"],"prompts":["person."]}).json()["id"])
        second=self.upload("blue")
        plan=self.post("/api/agent/plan",{"goal":"compare prompts","target":"person","mode":"template"}).json()
        b=self.wait_job(self.post("/api/agent/execute/"+plan["id"],{"image_id":second["id"],"prompts":["ignored"]}).json()["id"])
        groups={g["id"]:g for g in self.client.get("/api/experiments").json()}
        self.assertEqual(groups[a["id"]]["mode"],"manual")
        self.assertEqual(groups[b["id"]]["mode"],"agent")
        detail=self.client.get("/api/experiments/"+b["id"]).json()
        self.assertEqual(detail["request"]["image_id"],second["id"])
        self.assertEqual(detail["run_ids"],b["run_ids"])
        self.assertEqual(len(detail["run_ids"]),3)

    def test_keep_delete_restore_preserves_shared_results_and_persists(self):
        req={"image_id":self.image["id"],"prompts":["person."]}
        a=self.wait_job(self.post("/api/jobs",req).json()["id"])
        b=self.wait_job(self.post("/api/jobs",req).json()["id"])
        url="/api/experiments/"+a["id"]
        self.assertTrue(self.post(url+"/keep",{"kept":True}).json()["kept"])
        self.assertEqual(self.client.get("/api/experiments").json()[0]["id"],a["id"])
        self.assertEqual(self.post(url+"/delete",{}).status_code,200)
        self.assertEqual([g["id"] for g in self.client.get("/api/experiments").json()],[b["id"]])
        self.assertTrue(self.client.get("/api/experiments?deleted=true").json()[0]["kept"])
        service=Experiments(self.app.state.store,self.app.state.jobs.lock)
        self.assertTrue(service.get(a["id"])["deleted"])
        self.assertEqual(len(self.client.get("/api/runs").json()),1)
        self.assertEqual(self.client.get(f"/api/images/{self.image['id']}/file").status_code,200)
        restored=self.post(url+"/restore",{}).json()
        self.assertFalse(restored["deleted"])
        self.assertEqual(restored["run_ids"],a["run_ids"])
        self.assertEqual(self.client.post(url+"/delete",json={}).status_code,403)

    def test_running_group_cannot_be_deleted(self):
        entered,release=threading.Event(),threading.Event()
        original=self.detector.predict
        def slow(*args,**kwargs):
            entered.set()
            if not release.wait(5): raise RuntimeError("test timed out")
            return original(*args,**kwargs)
        with patch.object(self.detector,"predict",side_effect=slow):
            job=self.post("/api/jobs",{"image_id":self.image["id"],"prompts":["person."]}).json()
            try:
                self.assertTrue(entered.wait(2))
                self.assertEqual(self.post("/api/experiments/"+job["id"]+"/delete",{}).status_code,409)
            finally:
                release.set()
            self.assertEqual(self.wait_job(job["id"])["status"],"complete")

    def test_sample_groups_are_idempotent_and_do_not_reappear_after_delete(self):
        self.post("/api/sample",{})
        groups=self.client.get("/api/experiments").json()
        self.assertEqual(len(groups),1)
        self.assertEqual(groups[0]["mode"],"manual")
        self.assertEqual(groups[0]["source"],"recorded_inference")
        self.post("/api/experiments/"+groups[0]["id"]+"/delete",{})
        self.post("/api/sample",{})
        Experiments(self.app.state.store,self.app.state.jobs.lock)
        self.assertEqual(self.client.get("/api/experiments").json(),[])
        self.assertEqual(len(self.client.get("/api/experiments?deleted=true").json()),1)

    def test_settings_api_never_echoes_keys_and_applies_without_restart(self):
        body={"provider":"deepseek","base_url":"https://api.deepseek.com","model":"deepseek-flash","api_key":"private-test-key","thinking":"disabled"}
        r=self.post("/api/settings/llm",body)
        self.assertEqual(r.status_code,200)
        self.assertNotIn(body["api_key"],r.text)
        self.assertTrue(self.client.get("/api/status").json()["llm_configured"])
        self.assertNotIn(body["api_key"],self.client.get("/api/settings/llm").text)
        invalid=self.post("/api/settings/llm",{**body,"base_url":"https://another.example"})
        self.assertEqual(invalid.status_code,422)
        self.assertNotIn(body["api_key"],invalid.text)
        self.assertEqual(self.client.post("/api/settings/llm",json=body).status_code,403)


if __name__=="__main__": unittest.main()
