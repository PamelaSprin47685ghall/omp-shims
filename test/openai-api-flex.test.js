import { describe, expect, test } from "bun:test";
import { enforceOfficialTerraFlex, installOpenAiApiFlex } from "../lib/openai-api-flex.js";

const original = { model: "gpt-6.1-terra", stream: true, reasoning: { effort: "medium" },
  input: [{ role: "user", content: "synthetic" }], max_output_tokens: 16 };

describe("official OpenAI Responses Flex for Terra only", () => {
  test("adds flex tier without altering reasoning, input, output or tool options", () => {
    const value = enforceOfficialTerraFlex(JSON.stringify(original));
    expect(JSON.parse(value)).toEqual({ ...original, service_tier: "flex" });
    expect(enforceOfficialTerraFlex(JSON.stringify({ ...original, service_tier: "flex" }))).toBeUndefined();
    expect(JSON.parse(enforceOfficialTerraFlex(JSON.stringify({
      ...original, service_tier: "default",
    }))).service_tier).toBe("flex");
  });
  test("leaves unrelated models, malformed requests and OpenAI Codex calls untouched", () => {
    for (const value of ["not-json", "[]", JSON.stringify({}), JSON.stringify({
      ...original, model: "gpt-6.1-sol",
    })]) expect(enforceOfficialTerraFlex(value)).toBeUndefined();
  });
  test("rewrites official Responses fetch(url,init) with proper headers", async () => {
    let handler;
    installOpenAiApiFlex({ addFetchHandler: (h) => handler=h });
    let seen;
    const result=await handler("https://api.openai.com/v1/responses", {
      method:"POST", body:JSON.stringify(original), headers:{ "content-length":"12",authorization:"Bearer test-only" },
    }, (url,init) => {
      seen={url,init};return Response.json({ok:true});
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(seen.init.body).service_tier).toBe("flex");
    expect(JSON.parse(seen.init.body).reasoning.effort).toBe("medium");
    expect(new Headers(seen.init.headers).get("content-length")).toBeNull();
    expect(new Headers(seen.init.headers).get("authorization")).toBe("Bearer test-only");
  });
  test("rewrites fetch(Request) but not endpoints or hosts other than official Responses", async () => {
    let handler;
    installOpenAiApiFlex({ addFetchHandler: h=>handler=h });
    const req=new Request("https://api.openai.com/v1/responses", {
      method:"POST", body:JSON.stringify(original),headers:{"content-type":"application/json"},
    });
    await handler(req,undefined,async (input,init)=>{
      expect(input).toBeInstanceOf(Request);
      expect(JSON.parse(await input.clone().text()).service_tier).toBe("flex");
      expect(init).toBeUndefined();return Response.json({ok:true});
    });
    const notOurs=[
      "https://chatgpt.com/backend-api/codex/responses",
      "https://example.com/v1/responses",
      "https://api.openai.com/v1/chat/completions",
    ];
    for (const url of notOurs) {
      let untouched;
      await handler(url,{method:"POST",body:JSON.stringify(original)},(input,init)=>{
        untouched={input,init};return Response.json({ok:true});
      });
      expect(untouched.input).toBe(url);
      expect(untouched.init.body).toBe(JSON.stringify(original));
    }
  });
});
