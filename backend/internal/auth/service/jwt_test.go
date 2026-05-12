package service

import "testing"

func TestJWTService(t *testing.T) {
	svc := NewJWTService("secret", 3600, 7200)
	token, err := svc.IssueAccess("u1", "o1", "n1")
	if err != nil {
		t.Fatalf("issue access: %v", err)
	}
	claims, err := svc.Parse(token)
	if err != nil {
		t.Fatalf("parse access: %v", err)
	}
	if claims.UserID != "u1" || claims.OpenID != "o1" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}
