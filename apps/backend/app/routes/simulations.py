from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.models.enums import Difficulty, UserRole
from app.models.user import User
from app.schemas.simulation import ScenarioResponse

router = APIRouter()

# Static scenario definitions — these are configuration, not user data.
SCENARIOS = [
    {
        "id": "scenario-1",
        "title": "Price Negotiation",
        "description": "A budget-conscious buyer pushes back hard on price. They have a competing offer.",
        "difficulty": Difficulty.MEDIUM,
        "ai_persona": {
            "name": "Mike",
            "budget": 28000,
            "personality": "Analytical, calm, does research. Will walk away if numbers don't work.",
            "vehicle": "2024 Toyota Camry LE",
            "challenges": [
                "Has a lower offer from competitor",
                "Focused on OTD price",
                "Asks for fee breakdown",
            ],
        },
    },
    {
        "id": "scenario-2",
        "title": "Trade-In Pushback",
        "description": "A buyer emotionally attached to their trade-in thinks it's worth more than your appraisal.",
        "difficulty": Difficulty.EASY,
        "ai_persona": {
            "name": "Sarah",
            "budget": 35000,
            "personality": "Emotional, loves her current car, first dealership visit in 8 years.",
            "vehicle": "2024 Honda CR-V EX-L",
            "challenges": [
                "Thinks trade-in worth $5k more",
                "Gets upset if car dismissed",
                "Needs to feel respected",
            ],
        },
    },
    {
        "id": "scenario-3",
        "title": "F&I Gauntlet",
        "description": "An informed buyer who declines everything in F&I. Can you find products that make sense?",
        "difficulty": Difficulty.HARD,
        "ai_persona": {
            "name": "James",
            "budget": 42000,
            "personality": "Skeptical, extensive research, knows dealer cost on most F&I products.",
            "vehicle": "2024 Ford F-150 XLT",
            "challenges": [
                "Pre-approved at 4.9%",
                "Knows GAP costs $300 via insurance",
                "Calls out pressure tactics",
            ],
        },
    },
    {
        "id": "scenario-4",
        "title": "The Walk-Away",
        "description": "A buyer ready to leave. One chance to save the deal without dropping price further.",
        "difficulty": Difficulty.HARD,
        "ai_persona": {
            "name": "David",
            "budget": 31000,
            "personality": "Quiet, patient, been at dealership 3 hours. Running out of goodwill.",
            "vehicle": "2023 Chevrolet Silverado LT",
            "challenges": [
                "Already walked once",
                "Won't respond to urgency",
                "Values time over saving $500",
            ],
        },
    },
]


@router.get("/scenarios", response_model=list[ScenarioResponse])
def list_scenarios(user: User = Depends(get_current_user)):
    if user.role != UserRole.DEALER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only dealers can access training scenarios",
        )
    return SCENARIOS
