package domain

import "time"

type CreateRequest struct {
	RequestID   string    `json:"request_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	VenueName   string    `json:"venue_name"`
	Address     string    `json:"address"`
	Latitude    *float64  `json:"latitude"`
	Longitude   *float64  `json:"longitude"`
	StartsAt    time.Time `json:"starts_at"`
	Timezone    string    `json:"timezone"`
	Budget      int       `json:"budget"`
	Payment     string    `json:"payment"`
	Capacity    int       `json:"capacity"`
}
type Profile struct {
	UserID   string `json:"user_id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}
type Participant struct {
	Profile
	Status   string `json:"status"`
	Revision int    `json:"revision"`
	Note     string `json:"note"`
}
type Meetup struct {
	ID             string        `json:"id"`
	Host           Profile       `json:"host"`
	Title          string        `json:"title"`
	Description    string        `json:"description"`
	VenueName      string        `json:"venue_name"`
	Address        string        `json:"address"`
	Latitude       *float64      `json:"latitude,omitempty"`
	Longitude      *float64      `json:"longitude,omitempty"`
	StartsAt       time.Time     `json:"starts_at"`
	EndsAt         time.Time     `json:"ends_at"`
	Timezone       string        `json:"timezone"`
	MealType       string        `json:"meal_type"`
	Budget         int           `json:"budget"`
	Payment        string        `json:"payment"`
	Capacity       int           `json:"capacity"`
	MemberCount    int           `json:"member_count"`
	Status         string        `json:"status"`
	IsHost         bool          `json:"is_host"`
	OwnStatus      string        `json:"own_status"`
	OwnRevision    int           `json:"own_revision"`
	CanEnterRoom   bool          `json:"can_enter_room"`
	Members        []Profile     `json:"members"`
	Applications   []Participant `json:"applications,omitempty"`
	ManagedMembers []Participant `json:"managed_members,omitempty"`
}
type Event struct {
	ID        string    `json:"id"`
	Actor     Profile   `json:"actor"`
	Kind      string    `json:"kind"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}
type ListQuery struct {
	Keyword   string
	MealType  string
	Date      string
	Timezone  string
	Budget    int
	Latitude  *float64
	Longitude *float64
	RadiusKM  float64
	Offset    int
	Limit     int
}
type ApplyRequest struct {
	RequestID string `json:"request_id"`
	Note      string `json:"note"`
}
type RespondRequest struct {
	Action   string `json:"action"`
	Revision int    `json:"revision"`
}
type MessageRequest struct {
	RequestID string `json:"request_id"`
	Content   string `json:"content"`
}
type ReportRequest struct {
	EventID string `json:"event_id"`
	Reason  string `json:"reason"`
}
