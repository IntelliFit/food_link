// Package foodmeasure keeps the declared food quantity and nutrition basis
// independent from mass. Cross-unit calculations require explicit evidence.
package foodmeasure

import (
	"fmt"
	"math"
)

type Unit string

const (
	Gram       Unit = "g"
	Milliliter Unit = "ml"
	Piece      Unit = "piece"
	Serving    Unit = "serving"
)

type Measurement struct {
	Amount            float64            `json:"amount"`
	Unit              Unit               `json:"unit"`
	BasisAmount       float64            `json:"basis_amount"`
	BasisUnit         Unit               `json:"basis_unit"`
	NutrientsPerBasis map[string]float64 `json:"nutrients_per_basis"`
	UnitConversions   map[Unit]float64   `json:"unit_conversions,omitempty"`
}

func validUnit(unit Unit) bool {
	return unit == Gram || unit == Milliliter || unit == Piece || unit == Serving
}

func finite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

func (m Measurement) Validate() error {
	if !validUnit(m.Unit) || !validUnit(m.BasisUnit) {
		return fmt.Errorf("食物单位仅支持克、毫升、个、份")
	}
	if !finite(m.Amount) || m.Amount <= 0 || !finite(m.BasisAmount) || m.BasisAmount <= 0 {
		return fmt.Errorf("食物份量和营养标示份量必须为有效正数")
	}
	if len(m.NutrientsPerBasis) == 0 {
		return fmt.Errorf("请填写营养标示数据")
	}
	for name, value := range m.NutrientsPerBasis {
		if name == "" || !finite(value) || value < 0 {
			return fmt.Errorf("营养标示数据必须为有效非负数")
		}
	}
	for unit, value := range m.UnitConversions {
		if !validUnit(unit) || !finite(value) || value <= 0 || (unit == m.BasisUnit && value != 1) {
			return fmt.Errorf("食物单位换算关系无效")
		}
	}
	if _, ok := m.Convert(m.Amount, m.Unit, m.BasisUnit); !ok {
		return fmt.Errorf("当前份量与营养标示单位不同，请补充明确的换算关系")
	}
	return nil
}

func (m Measurement) conversion(unit Unit) (float64, bool) {
	if !validUnit(unit) {
		return 0, false
	}
	if unit == m.BasisUnit {
		return 1, true
	}
	value, exists := m.UnitConversions[unit]
	return value, exists && finite(value) && value > 0
}

// Convert uses conversion values expressed as basis units per source unit.
// No density, piece weight or serving size is inferred.
func (m Measurement) Convert(amount float64, from, to Unit) (float64, bool) {
	if !finite(amount) || amount < 0 || !validUnit(from) || !validUnit(to) {
		return 0, false
	}
	if from == to {
		return amount, true
	}
	fromFactor, fromOK := m.conversion(from)
	toFactor, toOK := m.conversion(to)
	if !fromOK || !toOK {
		return 0, false
	}
	value := amount * fromFactor / toFactor
	return value, finite(value)
}

func (m Measurement) Scale(amount float64, unit Unit) (map[string]float64, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	basisQuantity, ok := m.Convert(amount, unit, m.BasisUnit)
	if !ok {
		return nil, fmt.Errorf("缺少食物单位换算关系")
	}
	result := make(map[string]float64, len(m.NutrientsPerBasis))
	for name, value := range m.NutrientsPerBasis {
		scaled := value * basisQuantity / m.BasisAmount
		if !finite(scaled) {
			return nil, fmt.Errorf("食物营养换算结果超出范围")
		}
		result[name] = scaled
	}
	return result, nil
}

func (m Measurement) Totals() (map[string]float64, error) { return m.Scale(m.Amount, m.Unit) }
func (m Measurement) Grams() (float64, bool)              { return m.Convert(m.Amount, m.Unit, Gram) }

func (m Measurement) Clone() *Measurement {
	copy := m
	copy.NutrientsPerBasis = make(map[string]float64, len(m.NutrientsPerBasis))
	for name, value := range m.NutrientsPerBasis {
		copy.NutrientsPerBasis[name] = value
	}
	if m.UnitConversions != nil {
		copy.UnitConversions = make(map[Unit]float64, len(m.UnitConversions))
		for unit, value := range m.UnitConversions {
			copy.UnitConversions[unit] = value
		}
	}
	return &copy
}
