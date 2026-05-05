package domain

import "github.com/golang-jwt/jwt/v5"

type Claims struct {
	UserID  string `json:"user_id"`
	OpenID  string `json:"openid"`
	UnionID string `json:"unionid,omitempty"`
	Type    string `json:"type,omitempty"`
	jwt.RegisteredClaims
}
