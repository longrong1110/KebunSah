from api_helpers import bearer


def test_no_header_is_401(client):
    r = client.post("/api/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


def test_bad_token_is_401(client):
    r = client.post("/api/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_token"


def test_wrong_scheme_is_401(client):
    r = client.post("/api/me", headers={"Authorization": "Basic tok-x"})
    assert r.status_code == 401


def test_first_login_creates_smallholder_profile(client, store):
    r = client.post("/api/me", headers=bearer("new-user"), json={"fullName": "  LIM MEI LING ", "language": "en"})
    assert r.status_code == 201
    body = r.json()
    assert body["role"] == "smallholder" and body["language"] == "en" and body["coopId"] is None
    person = store.get(f"persons/{body['personId']}")
    assert person["fullName"] == "LIM MEI LING" and person["isSynthetic"] is False
    user = store.get("users/new-user")
    assert user["role"] == "smallholder" and user["personId"] == body["personId"] and user["lastLoginAt"] is not None


def test_cannot_ask_for_a_higher_role(client, store):
    r = client.post("/api/me", headers=bearer("sneaky"), json={"fullName": "X", "role": "coop_admin", "coopId": "c1"})
    assert r.status_code == 201
    assert r.json()["role"] == "smallholder"
    assert store.get("users/sneaky")["coopId"] is None


def test_existing_profile_is_returned_and_login_time_updated(client, store, clock):
    r = client.post("/api/me", headers=bearer("officer-1"))
    assert r.status_code == 200
    assert r.json()["role"] == "field_officer"
    assert store.get("users/officer-1")["lastLoginAt"] == clock.t


def test_invalid_language_is_422(client):
    r = client.post("/api/me", headers=bearer("x"), json={"language": "xx"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_request"
