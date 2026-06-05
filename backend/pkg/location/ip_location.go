package location

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lionsoul2014/ip2region/binding/golang/xdb"
)

var searcher *xdb.Searcher

// Init 从指定路径加载 ip2region xdb 数据库到内存
func Init(dbPath string) error {
	cBuff, err := xdb.LoadContentFromFile(dbPath)
	if err != nil {
		return fmt.Errorf("load ip2region xdb from %s: %w", dbPath, err)
	}
	header, err := xdb.LoadHeaderFromBuff(cBuff)
	if err != nil {
		return fmt.Errorf("load ip2region header: %w", err)
	}
	version, err := xdb.VersionFromHeader(header)
	if err != nil {
		return fmt.Errorf("parse ip2region version: %w", err)
	}
	searcher, err = xdb.NewWithBuffer(version, cBuff)
	if err != nil {
		return fmt.Errorf("create ip2region searcher: %w", err)
	}
	return nil
}

// Close 释放 searcher 资源
func Close() {
	if searcher != nil {
		searcher.Close()
	}
}

// Location IP 定位结果
type Location struct {
	Country  string `json:"country"`
	Province string `json:"province"`
	City     string `json:"city"`
}

// GetRealIP 从 Gin 上下文获取真实客户端 IP（支持代理穿透）
func GetRealIP(c *gin.Context) string {
	ip := c.Request.Header.Get("X-Forwarded-For")
	if ip != "" {
		// X-Forwarded-For 可能包含多个 IP，取第一个
		if idx := strings.Index(ip, ","); idx != -1 {
			ip = strings.TrimSpace(ip[:idx])
		}
		return ip
	}
	ip = c.Request.Header.Get("X-Real-IP")
	if ip != "" {
		return ip
	}
	return c.ClientIP()
}

// GetLocation 根据 IP 字符串查询地理位置
func GetLocation(ip string) (Location, error) {
	if ip == "" || ip == "::1" {
		ip = "127.0.0.1"
	}

	region, err := searcher.Search(ip)
	if err != nil {
		return Location{}, fmt.Errorf("search ip %s: %w", ip, err)
	}

	// ip2region 返回格式：国家|区域|省份|城市|ISP
	parts := strings.Split(region, "|")
	loc := Location{}
	if len(parts) > 0 {
		loc.Country = normalizePart(parts[0])
	}
	if len(parts) > 2 {
		loc.Province = NormalizeProvince(normalizePart(parts[2]))
	}
	if len(parts) > 3 {
		loc.City = normalizePart(parts[3])
	}
	return loc, nil
}

// GetLocationByContext 从 Gin 上下文获取当前请求的地理位置
func GetLocationByContext(c *gin.Context) (Location, error) {
	return GetLocation(GetRealIP(c))
}

// normalizePart 清理 ip2region 的 0/空值
func normalizePart(s string) string {
	if s == "0" || s == "0.0.0.0" {
		return ""
	}
	return s
}

// NormalizeProvince 将 ip2region 返回的省份名称规范化为标准行政区划名称
// 例如：北京 → 北京市，广东 → 广东省
func NormalizeProvince(p string) string {
	if p == "" {
		return ""
	}
	switch p {
	case "北京":
		return "北京市"
	case "上海":
		return "上海市"
	case "天津":
		return "天津市"
	case "重庆":
		return "重庆市"
	case "内蒙古":
		return "内蒙古自治区"
	case "广西":
		return "广西壮族自治区"
	case "西藏":
		return "西藏自治区"
	case "宁夏":
		return "宁夏回族自治区"
	case "新疆":
		return "新疆维吾尔自治区"
	case "香港":
		return "香港特别行政区"
	case "澳门":
		return "澳门特别行政区"
	default:
		return p + "省"
	}
}
