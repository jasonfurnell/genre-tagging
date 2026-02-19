"""Config and phase profile routes.

Migrated from Flask routes.py — config CRUD + phase profile CRUD.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app.config import DEFAULT_CONFIG, load_config, save_config
from app.models.config import (
    AppConfig,
    ConfigUpdate,
    PhaseProfileCreate,
    PhaseProfileDuplicate,
    PhaseProfileListResponse,
    PhaseProfileUpdate,
)
from app.models.workshop import PhaseProfile
from app.phases import (
    create_profile,
    delete_profile,
    duplicate_profile,
    get_profile,
    list_profiles,
    update_profile,
    validate_phases,
)

router = APIRouter(prefix="/api", tags=["config"])


# ---------------------------------------------------------------------------
# Config CRUD
# ---------------------------------------------------------------------------


@router.get("/config", response_model=AppConfig)
async def get_config():
    return load_config()


@router.put("/config", response_model=AppConfig)
async def put_config(body: ConfigUpdate):
    config = load_config()
    updates = body.model_dump(exclude_none=True)
    config.update(updates)
    save_config(config)
    return config


@router.post("/config/reset", response_model=AppConfig)
async def reset_config():
    save_config(dict(DEFAULT_CONFIG))
    return DEFAULT_CONFIG


# ---------------------------------------------------------------------------
# Phase Profile CRUD
# ---------------------------------------------------------------------------


@router.get("/phase-profiles", response_model=PhaseProfileListResponse)
async def phase_profiles_list():
    return {"profiles": list_profiles()}


@router.get("/phase-profiles/{profile_id}", response_model=PhaseProfile)
async def phase_profiles_get(profile_id: str):
    p = get_profile(profile_id)
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    return p


@router.post("/phase-profiles", response_model=PhaseProfile, status_code=201)
async def phase_profiles_create(body: PhaseProfileCreate):
    phases_raw = [ph.model_dump() for ph in body.phases]
    ok, err = validate_phases(phases_raw)
    if not ok:
        raise HTTPException(status_code=400, detail=err)
    p = create_profile(body.name.strip(), description=body.description, phases=phases_raw)
    return p


@router.put("/phase-profiles/{profile_id}", response_model=PhaseProfile)
async def phase_profiles_update(profile_id: str, body: PhaseProfileUpdate):
    phases_raw = None
    if body.phases is not None:
        phases_raw = [ph.model_dump() for ph in body.phases]
        ok, err = validate_phases(phases_raw)
        if not ok:
            raise HTTPException(status_code=400, detail=err)
    p = update_profile(
        profile_id,
        name=body.name,
        description=body.description,
        phases=phases_raw,
    )
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found or is a default")
    return p


@router.delete("/phase-profiles/{profile_id}")
async def phase_profiles_delete(profile_id: str):
    if delete_profile(profile_id):
        return {"ok": True}
    raise HTTPException(status_code=404, detail="Profile not found or is a default")


@router.post(
    "/phase-profiles/{profile_id}/duplicate",
    response_model=PhaseProfile,
    status_code=201,
)
async def phase_profiles_duplicate(profile_id: str, body: PhaseProfileDuplicate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    p = duplicate_profile(profile_id, name)
    if not p:
        raise HTTPException(status_code=404, detail="Source profile not found")
    return p
