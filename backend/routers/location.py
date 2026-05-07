import json
import math
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

router = APIRouter()


# ---------- 天地图地名搜索代理 ----------

class LocationSearchRequest(BaseModel):
    """天地图地名搜索请求"""
    keyWord: str = Field(..., description="搜索关键字")
    count: int = Field(default=10, description="返回结果数量")
    lon: Optional[float] = Field(None, description="中心点经度（可选，用于周边搜索）")
    lat: Optional[float] = Field(None, description="中心点纬度（可选，用于周边搜索）")
    radius_km: Optional[float] = Field(3.0, description="周边搜索半径（公里），仅在传 lon/lat 时生效")


@router.post("/api/location/search")
async def location_search(body: LocationSearchRequest):
    """
    代理天地图地名搜索 API（避免小程序直连域名限制）
    """
    tk = os.getenv("TIANDITU_TK", "")
    if not tk:
        raise HTTPException(status_code=500, detail="后端未配置天地图 API Key")

    # 若传入中心点，则构造一个近似矩形范围（mapBound）
    # 天地图 v2/search 使用经纬度边界字符串：minLon,minLat,maxLon,maxLat
    map_bound = "73.44696044921875,3.408477306060791,135.08583068847656,53.557926071870545"
    try:
        if body.lon is not None and body.lat is not None:
            r_km = float(body.radius_km or 3.0)
            r_km = max(0.2, min(r_km, 20.0))
            lat = float(body.lat)
            lon = float(body.lon)
            # 1°纬度约 111km；经度缩放与纬度相关
            d_lat = r_km / 111.0
            cos_lat = math.cos(math.radians(lat))
            d_lon = r_km / (111.0 * (cos_lat if abs(cos_lat) > 1e-6 else 1e-6))
            min_lon = max(-180.0, lon - d_lon)
            max_lon = min(180.0, lon + d_lon)
            min_lat = max(-90.0, lat - d_lat)
            max_lat = min(90.0, lat + d_lat)
            map_bound = f"{min_lon},{min_lat},{max_lon},{max_lat}"
    except Exception as e:
        print(f"[location_search] mapBound 计算失败，回退全国范围: {e}")

    post_str = json.dumps({
        "keyWord": body.keyWord,
        "level": 12,
        "mapBound": map_bound,
        "queryType": 1,
        "start": 0,
        "count": body.count
    })

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.tianditu.gov.cn/v2/search",
                params={"postStr": post_str, "type": "query", "tk": tk}
            )
            data = resp.json()
            return data
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="天地图 API 请求超时")
    except Exception as e:
        print(f"[location_search] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"位置搜索失败: {str(e)}")


class LocationReverseRequest(BaseModel):
    """逆地理编码请求（经纬度 -> 地址）"""
    lat: float = Field(..., description="纬度")
    lon: float = Field(..., description="经度")


@router.post("/api/location/reverse")
async def location_reverse(body: LocationReverseRequest):
    """代理天地图逆地理编码，将经纬度转为地址描述"""
    tk = os.getenv("TIANDITU_TK", "")
    if not tk:
        raise HTTPException(status_code=500, detail="后端未配置天地图 API Key")
    post_str = json.dumps({"lon": body.lon, "lat": body.lat})
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://api.tianditu.gov.cn/geocoder",
                params={"postStr": post_str, "type": "geocode", "tk": tk}
            )
            data = resp.json()
            # 返回格式与天地图一致，便于前端直接使用
            return data
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="逆地理请求超时")
    except Exception as e:
        print(f"[location_reverse] 错误: {e}")
        raise HTTPException(status_code=500, detail=f"逆地理失败: {str(e)}")


# ---------- 地图选点页（天地图，供小程序 web-view 嵌入） ----------
MAP_PICKER_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <title>选择位置</title>
  <script src="https://api.tianditu.gov.cn/api?v=4.0&tk=__TIANDITU_TK__" type="text/javascript"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #mapDiv { width: 100%; height: 42vh; min-height: 200px; }
    .panel { padding: 12px; background: #fff; border-top: 1px solid #eee; }
    .search-row { display: flex; gap: 8px; margin-bottom: 10px; }
    .search-row input { flex: 1; height: 40px; padding: 0 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
    .search-row button { height: 40px; padding: 0 16px; background: #00bc7d; color: #fff; border: none; border-radius: 8px; font-size: 14px; }
    .selected-hint { font-size: 12px; color: #666; margin-bottom: 8px; min-height: 18px; }
    .result-list { max-height: 28vh; overflow-y: auto; }
    .result-item { padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .result-item:active { background: #f5f5f5; }
    .result-name { font-weight: 600; font-size: 14px; color: #111; }
    .result-address { font-size: 12px; color: #666; margin-top: 4px; }
    .btn-use { width: 100%; height: 44px; margin-top: 12px; background: #00bc7d; color: #fff; border: none; border-radius: 8px; font-size: 16px; }
  </style>
</head>
<body>
  <div id="mapDiv"></div>
  <div class="panel">
    <div class="search-row">
      <input type="text" id="keyword" placeholder="输入商家名/地名搜索" />
      <button type="button" id="btnSearch">搜索</button>
    </div>
    <div class="selected-hint" id="selectedHint">点击地图选点，或从搜索结果选择</div>
    <div class="result-list" id="resultList"></div>
    <button type="button" class="btn-use" id="btnUse">使用该位置</button>
  </div>
  <script>
    (function() {
      var tk = "__TIANDITU_TK__";
      var map = new T.Map("mapDiv");
      map.centerAndZoom(new T.LngLat(116.40769, 39.89945), 12);
      var marker = null;
      var selected = { name: "", address: "", longitude: null, latitude: null, lonlat: "", promptCity: "" };

      function removeMarker() {
        if (marker) { map.removeOverlay(marker); marker = null; }
      }
      function addMarker(lng, lat) {
        removeMarker();
        var pt = new T.LngLat(lng, lat);
        marker = new T.Marker(pt);
        map.addOverlay(marker);
      }
      function setSelected(obj) {
        selected = obj;
        var h = document.getElementById("selectedHint");
        if (selected.address || selected.name)
          h.textContent = (selected.name || "位置") + " " + (selected.address || "");
        else if (selected.longitude != null)
          h.textContent = "已选坐标: " + selected.latitude.toFixed(5) + ", " + selected.longitude.toFixed(5);
        else
          h.textContent = "点击地图选点，或从搜索结果选择";
      }
      function apiBase() {
        var u = window.location.origin;
        if (window.__API_BASE__) return window.__API_BASE__;
        return u;
      }
      map.addEventListener("click", function(e) {
        var lnglat = e.lnglat;
        var lng = lnglat.lng, lat = lnglat.lat;
        addMarker(lng, lat);
        selected = { name: "地图选点", address: "", longitude: lng, latitude: lat, lonlat: lng + "," + lat, promptCity: "" };
        var xhr = new XMLHttpRequest();
        xhr.open("POST", apiBase() + "/api/location/reverse");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              var d = JSON.parse(xhr.responseText);
              var addr = (d.address || d.formatted_address || d.result || "").toString();
              if (addr) selected.address = addr;
            } catch (e) {}
          }
          setSelected(selected);
        };
        xhr.send(JSON.stringify({ lon: lng, lat: lat }));
        setSelected(selected);
      });

      document.getElementById("btnSearch").onclick = function() {
        var kw = (document.getElementById("keyword").value || "").trim();
        if (!kw) return;
        var center = map.getCenter();
        var lng = center ? center.lng : 116.4;
        var lat = center ? center.lat : 39.9;
        var xhr = new XMLHttpRequest();
        xhr.open("POST", apiBase() + "/api/location/search");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = function() {
          var listEl = document.getElementById("resultList");
          if (xhr.status !== 200) { listEl.innerHTML = "<div class=\"result-item\">搜索失败</div>"; return; }
          try {
            var data = JSON.parse(xhr.responseText);
            var pois = data.pois || [];
            var promptCity = (data.prompt && data.prompt[0] && data.prompt[0].admins && data.prompt[0].admins[0]) ? data.prompt[0].admins[0].adminName : "";
            listEl.innerHTML = "";
            pois.forEach(function(poi) {
              var name = poi.name || "";
              var address = poi.address || "";
              var lonlat = (poi.lonlat || "").split(",");
              var lng = lonlat.length >= 2 ? parseFloat(lonlat[0]) : 0;
              var lat = lonlat.length >= 2 ? parseFloat(lonlat[1]) : 0;
              var div = document.createElement("div");
              div.className = "result-item";
              div.innerHTML = "<div class=\"result-name\">" + (name || "未命名") + "</div><div class=\"result-address\">" + address + "</div>";
              div.onclick = function() {
                if (lng && lat) {
                  map.centerAndZoom(new T.LngLat(lng, lat), 16);
                  addMarker(lng, lat);
                }
                setSelected({ name: name, address: address, longitude: lng, latitude: lat, lonlat: poi.lonlat || (lng + "," + lat), promptCity: promptCity });
              };
              listEl.appendChild(div);
            });
            if (pois.length === 0) listEl.innerHTML = "<div class=\"result-item\">未找到相关位置</div>";
          } catch (e) {
            listEl.innerHTML = "<div class=\"result-item\">解析失败</div>";
          }
        };
        xhr.send(JSON.stringify({ keyWord: kw, count: 20, lon: lng, lat: lat, radius_km: 5 }));
      };

      document.getElementById("btnUse").onclick = function() {
        if (selected.longitude == null && selected.latitude == null) {
          alert("请先点击地图选点或从搜索结果选择位置");
          return;
        }
        var payload = {
          name: selected.name || "",
          address: selected.address || "",
          longitude: selected.longitude,
          latitude: selected.latitude,
          lonlat: selected.lonlat || (selected.longitude + "," + selected.latitude),
          promptCity: selected.promptCity || ""
        };
        if (typeof wx !== "undefined" && wx.miniProgram) {
          wx.miniProgram.postMessage({ data: payload });
          wx.miniProgram.navigateBack();
        } else {
          console.log("selected", payload);
          alert("仅在小程序内可回传位置");
        }
      };
    })();
  </script>
</body>
</html>
"""


@router.get("/map-picker", response_class=HTMLResponse)
async def map_picker():
    """返回天地图地图选点页面（供小程序 web-view 使用），进入即显示地图，可点击选点、模糊搜索后地图自动定位到结果"""
    tk = os.getenv("TIANDITU_TK", "")
    if not tk:
        raise HTTPException(status_code=503, detail="未配置天地图密钥，无法加载地图选点页")
    html = MAP_PICKER_HTML.replace("__TIANDITU_TK__", tk)
    return HTMLResponse(html)

