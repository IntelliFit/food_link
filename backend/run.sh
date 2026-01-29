#!/bin/bash

# 启动 FastAPI 服务
uvicorn main:app --reload --host 0.0.0.0 --port 3010

