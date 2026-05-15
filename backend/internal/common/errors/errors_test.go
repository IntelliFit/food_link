package errors

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAppError_Error(t *testing.T) {
	err := &AppError{Code: 10001, Message: "not found", HTTPStatus: http.StatusNotFound}
	assert.Equal(t, "not found", err.Error())
}

func TestPredefinedErrors(t *testing.T) {
	assert.Equal(t, 10000, ErrInternal.Code)
	assert.Equal(t, http.StatusInternalServerError, ErrInternal.HTTPStatus)

	assert.Equal(t, 10001, ErrNotFound.Code)
	assert.Equal(t, http.StatusNotFound, ErrNotFound.HTTPStatus)

	assert.Equal(t, 10002, ErrBadRequest.Code)
	assert.Equal(t, http.StatusBadRequest, ErrBadRequest.HTTPStatus)

	assert.Equal(t, 20001, ErrUnauthorized.Code)
	assert.Equal(t, http.StatusUnauthorized, ErrUnauthorized.HTTPStatus)

	assert.Equal(t, 20003, ErrForbidden.Code)
	assert.Equal(t, http.StatusForbidden, ErrForbidden.HTTPStatus)

	assert.Equal(t, 10004, ErrNotImplemented.Code)
	assert.Equal(t, http.StatusNotImplemented, ErrNotImplemented.HTTPStatus)
}
