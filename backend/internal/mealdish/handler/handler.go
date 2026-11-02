package handler

import (
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/mealdish/service"

	"github.com/gin-gonic/gin"
)

// Handler serves the meal-dish prompt for the recognition waiting page and
// the result page. Every route needs a signed-in user.
type Handler struct {
	svc *service.Service
}

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return strings.TrimSpace(c.GetString(authmw.ContextUserIDKey)) }

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}

func (h *Handler) Start(c *gin.Context) {
	var input service.StartInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("请求格式不正确"))
		return
	}
	view, err := h.svc.StartPrompt(c.Request.Context(), userID(c), input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *Handler) ForTask(c *gin.Context) {
	view, err := h.svc.PromptForTask(c.Request.Context(), userID(c), c.Query("task_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *Handler) Answer(c *gin.Context) {
	var input service.AnswerInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("请求格式不正确"))
		return
	}
	view, err := h.svc.Answer(c.Request.Context(), userID(c), c.Param("prompt_id"), input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}

func (h *Handler) Dishes(c *gin.Context) {
	view, err := h.svc.CanteenDishes(c.Request.Context(), userID(c), c.Param("canteen_id"), c.Query("task_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, view)
}
