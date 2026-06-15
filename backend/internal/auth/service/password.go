package service

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

const (
	userPasswordHashAlgorithm  = "pbkdf2-sha256"
	userPasswordHashIterations = 210000
	userPasswordSaltBytes      = 16
	userPasswordKeyBytes       = 32
)

func HashUserPassword(password string) (string, error) {
	password = strings.TrimSpace(password)
	if len(password) < 8 {
		return "", fmt.Errorf("密码至少需要 8 位")
	}
	salt := make([]byte, userPasswordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("生成盐值失败: %w", err)
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, userPasswordHashIterations, userPasswordKeyBytes)
	if err != nil {
		return "", fmt.Errorf("生成密码哈希失败: %w", err)
	}
	return strings.Join([]string{
		userPasswordHashAlgorithm,
		strconv.Itoa(userPasswordHashIterations),
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	}, "$"), nil
}

func VerifyUserPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != userPasswordHashAlgorithm {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations <= 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	actual, err := pbkdf2.Key(sha256.New, strings.TrimSpace(password), salt, iterations, len(expected))
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
