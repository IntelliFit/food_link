from fastapi import APIRouter

router = APIRouter()


@router.get("/api")
async def root():
    """健康检查端点"""
    return {"message": "食物分析 API 服务运行中", "status": "ok"}


@router.get("/api/health")
async def health():
    """健康检查端点"""
    return {"status": "healthy"}
