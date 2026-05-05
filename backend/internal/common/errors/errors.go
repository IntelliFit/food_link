package errors

import "net/http"

type AppError struct {
	Code       int    `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"-"`
}

func (e *AppError) Error() string {
	return e.Message
}

var (
	ErrInternal       = &AppError{Code: 10000, Message: "internal server error", HTTPStatus: http.StatusInternalServerError}
	ErrNotFound       = &AppError{Code: 10001, Message: "resource not found", HTTPStatus: http.StatusNotFound}
	ErrBadRequest     = &AppError{Code: 10002, Message: "bad request", HTTPStatus: http.StatusBadRequest}
	ErrUnauthorized   = &AppError{Code: 20001, Message: "missing or invalid authorization", HTTPStatus: http.StatusUnauthorized}
	ErrForbidden      = &AppError{Code: 20003, Message: "forbidden", HTTPStatus: http.StatusForbidden}
	ErrNotImplemented = &AppError{Code: 10004, Message: "route registered but not migrated yet", HTTPStatus: http.StatusNotImplemented}
)
