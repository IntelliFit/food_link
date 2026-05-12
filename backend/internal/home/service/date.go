package service

import "time"

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

func ChinaToday() string {
	return time.Now().In(chinaTZ).Format("2006-01-02")
}
