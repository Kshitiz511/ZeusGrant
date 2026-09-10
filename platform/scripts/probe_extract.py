import json
import urllib.request

text = (
    "The Vendor shall deliver the quarterly compliance report by March 31, 2026. "
    "Customer must pay invoice #204 within 30 days of receipt. "
    "Vendor shall maintain SOC 2 certification throughout the term."
)

system = (
    "You are a contract compliance analyst. Read the contract text and extract "
    "every concrete obligation, deliverable, or deadline.\n"
    "Respond with ONLY a JSON object of this exact shape (no prose, no markdown):\n"
    '{"obligations": [{"description": "string", "due_date": "YYYY-MM-DD or null", '
    '"responsible": "string or null", "priority": "low|medium|high"}]}\n'
    "Example:\n"
    '{"obligations": [{"description": "Deliver quarterly report", '
    '"due_date": "2026-03-31", "responsible": "Vendor", "priority": "high"}]}'
)


def run(label, use_format):
    payload = {
        "model": "gemma3:4b",
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Contract text:\n{text}"},
        ],
    }
    if use_format:
        payload["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        "http://127.0.0.1:11434/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
    )
    resp = json.load(urllib.request.urlopen(req, timeout=180))
    print(f"=== {label} ===")
    print(resp["choices"][0]["message"]["content"])
    print()


run("WITH json_object", True)
run("WITHOUT json_object", False)
