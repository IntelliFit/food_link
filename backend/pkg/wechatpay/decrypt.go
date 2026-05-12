package wechatpay

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// DecryptResource decrypts WeChat Pay callback resource with AES-GCM.
func DecryptResource(resource map[string]any, apiV3Key string) (map[string]any, error) {
	ciphertext, _ := resource["ciphertext"].(string)
	nonce, _ := resource["nonce"].(string)
	associatedData, _ := resource["associated_data"].(string)

	if ciphertext == "" || nonce == "" {
		return nil, fmt.Errorf("missing ciphertext or nonce")
	}

	ciphertextBytes, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("decode ciphertext: %w", err)
	}

	block, err := aes.NewCipher([]byte(apiV3Key))
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", err)
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}

	var plaintext []byte
	if associatedData != "" {
		plaintext, err = aesgcm.Open(nil, []byte(nonce), ciphertextBytes, []byte(associatedData))
	} else {
		plaintext, err = aesgcm.Open(nil, []byte(nonce), ciphertextBytes, nil)
	}
	if err != nil {
		return nil, fmt.Errorf("decrypt: %w", err)
	}

	var result map[string]any
	if err := json.Unmarshal(plaintext, &result); err != nil {
		return nil, fmt.Errorf("unmarshal plaintext: %w", err)
	}
	return result, nil
}
