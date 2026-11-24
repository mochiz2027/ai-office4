from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """서버 상태 확인용 엔드포인트입니다."""
    return {"status": "ok"}
