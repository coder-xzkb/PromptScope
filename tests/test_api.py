import base64
import io
import tempfile
import time
import unittest
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
from promptscope.app import create_app
from promptscope.detector import GroundingDetector


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


if __name__=="__main__": unittest.main()
