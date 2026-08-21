import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.parse
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Form, Request, Depends
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "")
CLIENT_ID = os.getenv("OAUTH_CLIENT_ID", "discourse")
CLIENT_SECRET = os.getenv("OAUTH_CLIENT_SECRET", "")
BASE_URL = os.getenv("BASE_URL", "")
DISCOURSE_URL = os.getenv("DISCOURSE_URL", "")

app = FastAPI(title="Telegram OAuth2 Bridge")

auth_codes: dict = {}
access_tokens: dict = {}
auth_sessions: dict = {}

def cleanup_expired():
    now = time.time()
    for store in (auth_codes, access_tokens, auth_sessions):
        expired = [k for k, v in store.items() if v.get("expires_at", 0) < now]
        for k in expired:
            del store[k]

def verify_telegram_data(data: dict) -> bool:
    check_hash = data.pop("hash", None)
    if not check_hash:
        return False
    data_check_arr = sorted([f"{k}={v}" for k, v in data.items()])
    data_check_string = "\n".join(data_check_arr)
    secret_key = hashlib.sha256(BOT_TOKEN.encode()).digest()
    computed_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    if computed_hash != check_hash:
        return False
    auth_date = int(data.get("auth_date", 0))
    if time.time() - auth_date > 3600:
        return False
    return True

@app.get("/authorize", response_class=HTMLResponse)
async def authorize(
    client_id: str = Query(...),
    redirect_uri: str = Query(...),
    response_type: str = Query("code"),
    scope: str = Query(""),
    state: str = Query(""),
):
    if client_id != CLIENT_ID:
        raise HTTPException(status_code=400, detail="Invalid client_id")
    session_id = secrets.token_urlsafe(32)
    auth_sessions[session_id] = {
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": scope,
        "expires_at": time.time() + 600,
    }
    cleanup_expired()
    callback_url = f"{BASE_URL}/callback?session_id={session_id}"
    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Вход через Telegram</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; background: #f0f2f5;
        }}
        .card {{
            background: white; border-radius: 12px; padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;
            max-width: 400px; width: 90%;
        }}
        .card h1 {{ font-size: 20px; color: #333; margin-bottom: 8px; }}
        .card p {{ font-size: 14px; color: #666; margin-bottom: 24px; }}
        .tg-widget {{ display: flex; justify-content: center; }}
    </style>
</head>
<body>
    <div class="card">
        <h1>Вход через Telegram</h1>
        <p>Нажмите кнопку ниже для авторизации</p>
        <div class="tg-widget">
            <script async src="https://telegram.org/js/telegram-widget.js?22"
                data-telegram-login="{BOT_USERNAME}"
                data-size="large"
                data-radius="8"
                data-auth-url="{callback_url}"
                data-request-access="write">
            </script>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html)

@app.get("/callback")
async def telegram_callback(request: Request, session_id: str = Query(...)):
    params = dict(request.query_params)
    params.pop("session_id", None)
    session = auth_sessions.pop(session_id, None)
    if not session or session["expires_at"] < time.time():
        raise HTTPException(status_code=400, detail="Session expired or invalid")
    tg_data = {k: v for k, v in params.items()}
    verify_data = dict(tg_data)
    if not verify_telegram_data(verify_data):
        raise HTTPException(status_code=403, detail="Telegram verification failed")
    tg_id = tg_data.get("id", "")
    user_data = {
        "id": str(tg_id),
        "username": tg_data.get("username", f"tg_{tg_id}"),
        "first_name": tg_data.get("first_name", ""),
        "last_name": tg_data.get("last_name", ""),
        "photo_url": tg_data.get("photo_url", ""),
        "email": f"{tg_id}@t.me",
    }
    code = secrets.token_urlsafe(32)
    auth_codes[code] = {
        "user_data": user_data,
        "redirect_uri": session["redirect_uri"],
        "expires_at": time.time() + 300,
    }
    redirect_params = {"code": code}
    if session.get("state"):
        redirect_params["state"] = session["state"]
    redirect_url = session["redirect_uri"]
    separator = "&" if "?" in redirect_url else "?"
    redirect_url += separator + urllib.parse.urlencode(redirect_params)
    return RedirectResponse(url=redirect_url)

@app.post("/token")
async def token(
    grant_type: str = Form("authorization_code"),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    client_id: str = Form(""),
    client_secret: str = Form(""),
):
    if client_id != CLIENT_ID or client_secret != CLIENT_SECRET:
        raise HTTPException(status_code=401, detail="Invalid client credentials")
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="Unsupported grant_type")
    code_data = auth_codes.pop(code, None)
    if not code_data or code_data["expires_at"] < time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    access_token = secrets.token_urlsafe(32)
    access_tokens[access_token] = {
        "user_data": code_data["user_data"],
        "expires_at": time.time() + 3600,
    }
    cleanup_expired()
    return JSONResponse({
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 3600,
    })

security = HTTPBearer()

@app.get("/userinfo")
async def userinfo(credentials: HTTPAuthorizationCredentials = Depends(security)):
    tok = credentials.credentials
    token_data = access_tokens.get(tok)
    if not token_data or token_data["expires_at"] < time.time():
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = token_data["user_data"]
    return JSONResponse({
        "id": user["id"],
        "email": user["email"],
        "name": f"{user['first_name']} {user.get('last_name', '')}".strip(),
        "username": user["username"],
        "avatar_url": user.get("photo_url", ""),
    })

@app.get("/health")
async def health():
    return {"status": "ok"}
