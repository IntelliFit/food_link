package service

import (
	"time"

	"food_link/backend/internal/auth/domain"

	"github.com/golang-jwt/jwt/v5"
)

type JWTService struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewJWTService(secret string, accessTTLSeconds, refreshTTLSeconds int64) *JWTService {
	return &JWTService{
		secret:     []byte(secret),
		accessTTL:  time.Duration(accessTTLSeconds) * time.Second,
		refreshTTL: time.Duration(refreshTTLSeconds) * time.Second,
	}
}

func (s *JWTService) IssueAccess(userID, openID, unionID string) (string, error) {
	return s.issue(userID, openID, unionID, "", s.accessTTL)
}

func (s *JWTService) IssueRefresh(userID, openID string) (string, error) {
	return s.issue(userID, openID, "", "refresh", s.refreshTTL)
}

func (s *JWTService) Parse(tokenString string) (*domain.Claims, error) {
	claims := &domain.Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		return s.secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, jwt.ErrTokenInvalidClaims
	}
	return claims, nil
}

func (s *JWTService) issue(userID, openID, unionID, typ string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := domain.Claims{
		UserID:  userID,
		OpenID:  openID,
		UnionID: unionID,
		Type:    typ,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}
