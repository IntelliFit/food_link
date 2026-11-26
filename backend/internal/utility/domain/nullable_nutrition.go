package domain

import (
	"encoding/json"
	"reflect"
	"strings"
)

func (n ManualFoodNutrients) MarshalJSON() ([]byte, error) {
	type plain ManualFoodNutrients
	body, err := json.Marshal(plain(n))
	if err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	value := reflect.ValueOf(n)
	typ := value.Type()
	for i := 0; i < value.NumField(); i++ {
		if value.Field(i).Kind() == reflect.Float64 {
			key := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
			token, e := json.Marshal(value.Field(i).Float())
			if e != nil {
				return nil, e
			}
			fields[key] = token
		}
	}
	for _, key := range n.UnknownFields {
		fields[key] = json.RawMessage("null")
	}
	return json.Marshal(fields)
}
