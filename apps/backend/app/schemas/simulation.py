from pydantic import BaseModel

from app.models.enums import Difficulty


class ScenarioResponse(BaseModel):
    id: str
    title: str
    description: str
    difficulty: Difficulty
    ai_persona: dict


class SimulationStart(BaseModel):
    scenario_id: str
