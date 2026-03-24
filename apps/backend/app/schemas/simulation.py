from pydantic import BaseModel


class ScenarioResponse(BaseModel):
    id: str
    title: str
    description: str
    difficulty: str
    ai_persona: dict


class SimulationStart(BaseModel):
    scenario_id: str
