package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/mealmeetup/domain"
	"food_link/backend/internal/mealmeetup/service"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Handler struct{ svc *service.Service }

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }
func (h *Handler) Register(read, write *gin.RouterGroup) {
	read.GET("", h.List)
	read.GET("/:id", h.Detail)
	write.GET("/mine", h.Mine)
	write.POST("", h.Create)
	write.POST("/:id/applications", h.Apply)
	write.POST("/:id/applications/:user_id/respond", h.Respond)
	write.POST("/:id/leave", h.Leave)
	write.POST("/:id/cancel", h.Cancel)
	write.GET("/:id/messages", h.Messages)
	write.POST("/:id/messages", h.SendMessage)
	write.POST("/:id/reports", h.Report)
}
func (h *Handler) begin(c *gin.Context) bool {
	for _, key := range []string{"id", "user_id", "report_id"} {
		if v := c.Param(key); v != "" {
			if _, err := uuid.Parse(v); err != nil {
				response.Error(c, commonerrors.ErrBadRequest)
				return false
			}
		}
	}
	logger.Info(c.Request.Context(), "进入约饭请求", slog.String("user_id", c.GetString(authmw.ContextUserIDKey)), slog.String("meetup_id", c.Param("id")), slog.String("path", c.FullPath()))
	return true
}
func (h *Handler) finish(c *gin.Context, data any, err error) {
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = commonerrors.ErrNotFound
		}
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "约饭请求完成", slog.String("user_id", c.GetString(authmw.ContextUserIDKey)), slog.String("meetup_id", c.Param("id")), slog.String("path", c.FullPath()))
	response.Success(c, data)
}
func bind(c *gin.Context, body any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	if c.Request.ContentLength > 16<<10 {
		response.Error(c, commonerrors.ErrBadRequest)
		return false
	}
	if err := c.ShouldBindJSON(body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return false
	}
	return true
}
func (h *Handler) list(c *gin.Context, mine bool) {
	if !h.begin(c) {
		return
	}
	q := domain.ListQuery{Keyword: c.Query("keyword"), MealType: c.Query("meal_type"), Date: c.Query("date"), Timezone: c.Query("timezone")}
	for key, dst := range map[string]*int{"limit": &q.Limit, "offset": &q.Offset, "budget": &q.Budget} {
		if raw := c.Query(key); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil {
				h.finish(c, nil, commonerrors.ErrBadRequest)
				return
			}
			*dst = n
		}
	}
	for _, key := range []string{"latitude", "longitude", "radius_km"} {
		if raw := c.Query(key); raw != "" {
			v, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				h.finish(c, nil, commonerrors.ErrBadRequest)
				return
			}
			switch key {
			case "latitude":
				q.Latitude = &v
			case "longitude":
				q.Longitude = &v
			case "radius_km":
				q.RadiusKM = v
			}
		}
	}
	rows, err := h.svc.List(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), mine, q)
	h.finish(c, gin.H{"list": rows}, err)
}
func (h *Handler) List(c *gin.Context) { h.list(c, false) }
func (h *Handler) Mine(c *gin.Context) { h.list(c, true) }
func (h *Handler) Detail(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	row, err := h.svc.Detail(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"))
	h.finish(c, row, err)
}
func (h *Handler) Create(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req domain.CreateRequest
	if !bind(c, &req) {
		return
	}
	id, err := h.svc.Create(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), req)
	h.finish(c, gin.H{"id": id}, err)
}
func (h *Handler) Apply(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req domain.ApplyRequest
	if !bind(c, &req) {
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.Apply(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"), req))
}
func (h *Handler) Respond(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req domain.RespondRequest
	if !bind(c, &req) {
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.Respond(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"), c.Param("user_id"), req))
}
func (h *Handler) Leave(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req struct {
		Revision int `json:"revision"`
	}
	if !bind(c, &req) {
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.Leave(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"), req.Revision))
}
func (h *Handler) Cancel(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.Cancel(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id")))
}
func (h *Handler) Messages(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	rows, err := h.svc.Messages(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"))
	h.finish(c, gin.H{"list": rows}, err)
}
func (h *Handler) SendMessage(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req domain.MessageRequest
	if !bind(c, &req) {
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.SendMessage(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"), req))
}
func (h *Handler) Report(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req domain.ReportRequest
	if !bind(c, &req) {
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.Report(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("id"), req))
}
func (h *Handler) AdminReports(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	rows, err := h.svc.Reports(c.Request.Context())
	h.finish(c, gin.H{"list": rows}, err)
}
func (h *Handler) AdminResolve(c *gin.Context) {
	if !h.begin(c) {
		return
	}
	var req struct {
		Action string `json:"action"`
	}
	if !bind(c, &req) {
		return
	}
	if req.Action != "hide" && req.Action != "dismiss" {
		h.finish(c, nil, commonerrors.ErrBadRequest)
		return
	}
	h.finish(c, gin.H{"success": true}, h.svc.ResolveReport(c.Request.Context(), c.Param("report_id"), req.Action == "hide"))
}
