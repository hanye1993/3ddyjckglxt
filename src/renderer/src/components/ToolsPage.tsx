import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Typography,
  Upload,
  message
} from 'antd'
import {
  CalculatorOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileExcelOutlined,
  PlusOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { brandsForTech, findBrand } from '../data/filamentBrands'
import { FILAMENT_MATERIALS } from '../data/filamentMaterials'
import { useFilamentStore } from '../stores/filamentStore'
import type { SpoolRecord } from '../types/filament'
import { buildQuoteWorkbook, type QuoteOptionCosts } from '../utils/quoteXlsx'

type TechMode = 'fdm' | 'resin'
type PricingMode = 'markup' | 'margin'

type MaterialPreset = {
  id: string
  label: string
  tech: TechMode
  pricePerKg: number
  density?: number
}

type PrinterPreset = {
  id: string
  label: string
  watts: number
}

/** 一条可供顾客选择的耗材方案（厂商/颜色影响单价） */
type MaterialOption = {
  id: string
  name: string
  brandId: string
  materialId: string
  color: string
  colorHex: string
  pricePerKg: number
  spoolId: string | null
  note: string
}

type OptionResult = MaterialOption & {
  brandLabel: string
  materialLabel: string
  specLabel: string
  spoolLabel?: string
  costs: QuoteOptionCosts
}

const PRESET_COLORS: { label: string; hex: string }[] = [
  { label: '黑', hex: '#1a1a1a' },
  { label: '白', hex: '#f5f5f5' },
  { label: '灰', hex: '#8c8c8c' },
  { label: '红', hex: '#cf1322' },
  { label: '橙', hex: '#d46b08' },
  { label: '黄', hex: '#d4b106' },
  { label: '绿', hex: '#389e0d' },
  { label: '蓝', hex: '#0958d9' },
  { label: '青', hex: '#08979c' },
  { label: '紫', hex: '#531dab' },
  { label: '粉', hex: '#c41d7f' },
  { label: '棕', hex: '#874d00' },
  { label: '透明', hex: '#d9d9d9' },
  { label: '金', hex: '#d4a017' },
  { label: '银', hex: '#bfbfbf' }
]

const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'pla', label: 'PLA', tech: 'fdm', pricePerKg: 65, density: 1.24 },
  { id: 'petg', label: 'PETG', tech: 'fdm', pricePerKg: 75, density: 1.27 },
  { id: 'abs', label: 'ABS', tech: 'fdm', pricePerKg: 70, density: 1.04 },
  { id: 'asa', label: 'ASA', tech: 'fdm', pricePerKg: 95, density: 1.07 },
  { id: 'tpu', label: 'TPU', tech: 'fdm', pricePerKg: 120, density: 1.21 },
  { id: 'pa-cf', label: '尼龙 / 碳纤维', tech: 'fdm', pricePerKg: 280, density: 1.15 },
  { id: 'resin-std', label: '标准树脂', tech: 'resin', pricePerKg: 90, density: 1.1 },
  { id: 'resin-abs', label: '高韧树脂', tech: 'resin', pricePerKg: 140, density: 1.12 },
  { id: 'resin-cast', label: '铸造树脂', tech: 'resin', pricePerKg: 220, density: 1.13 }
]

const PRINTER_PRESETS: PrinterPreset[] = [
  { id: 'a1mini', label: 'Bambu A1 mini', watts: 90 },
  { id: 'a1', label: 'Bambu A1', watts: 150 },
  { id: 'p1s', label: 'Bambu P1S', watts: 130 },
  { id: 'x1c', label: 'Bambu X1C', watts: 140 },
  { id: 'k2', label: '创想 K2 / 同类', watts: 350 },
  { id: 'klipper', label: 'Klipper 通用机', watts: 200 },
  { id: 'resin-elegoo', label: '光固化（中型）', watts: 120 },
  { id: 'custom', label: '自定义功率', watts: 200 }
]

const STORAGE_KEY = 'printer-monitor.quote-calc.v2'
const MAX_OPTIONS = 8

type SavedDefaults = {
  tech: TechMode
  materialId: string
  pricePerKg: number
  wastePct: number
  printerId: string
  watts: number
  electricity: number
  wearPerHour: number
  laborRate: number
  packaging: number
  shipping: number
  failPct: number
  pricingMode: PricingMode
  markupPct: number
  marginPct: number
  minPrice: number
}

function loadDefaults(): Partial<SavedDefaults> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('printer-monitor.quote-calc.v1')
    if (!raw) return {}
    return JSON.parse(raw) as Partial<SavedDefaults>
  } catch {
    return {}
  }
}

function saveDefaults(data: SavedDefaults) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

function yuan(n: number) {
  return `¥${n.toFixed(2)}`
}

function newOptionId() {
  return crypto.randomUUID()
}

function pricePerKgFromSpool(s: SpoolRecord): number | null {
  if (s.price == null || !Number.isFinite(s.price) || s.price <= 0) return null
  const kg = (s.totalGrams || 0) / 1000
  if (kg <= 0) return null
  return Math.round((s.price / kg) * 100) / 100
}

function spoolShortLabel(s: SpoolRecord): string {
  const brand = findBrand(s.brandId)?.name || s.brandId
  const mat = FILAMENT_MATERIALS.find((m) => m.id === s.material)?.label || s.material
  return `${brand} · ${mat} · ${s.color}`
}

function spoolRemainLabel(s: SpoolRecord): string {
  return `${spoolShortLabel(s)}（剩 ${Math.round(s.remainGrams)} g）`
}

function matchPresetId(materialId: string, tech: TechMode): string | null {
  const exact = MATERIAL_PRESETS.find((m) => m.id === materialId && m.tech === tech)
  if (exact) return exact.id
  const aliases: Record<string, string> = {
    'resin-standard': 'resin-std',
    'resin-tough': 'resin-abs',
    'resin-abs-like': 'resin-abs',
    'resin-castable': 'resin-cast',
    pa: 'pa-cf'
  }
  const mapped = aliases[materialId]
  if (mapped && MATERIAL_PRESETS.some((m) => m.id === mapped && m.tech === tech)) {
    return mapped
  }
  const prefix = MATERIAL_PRESETS.find(
    (m) => m.tech === tech && (materialId.startsWith(m.id) || m.id.startsWith(materialId))
  )
  return prefix?.id ?? null
}

function brandLabelOf(brandId: string): string {
  const b = findBrand(brandId)
  if (!b) return brandId || '—'
  return b.name
}

function materialTypeLabel(materialId: string): string {
  return (
    MATERIAL_PRESETS.find((m) => m.id === materialId)?.label ||
    FILAMENT_MATERIALS.find((m) => m.id === materialId)?.label ||
    materialId
  )
}

/** 厂商 · 材料 · 颜色 — 给顾客看的完整规格 */
function buildSpecLabel(opt: Pick<MaterialOption, 'brandId' | 'materialId' | 'color'>): string {
  const parts = [brandLabelOf(opt.brandId), materialTypeLabel(opt.materialId), opt.color.trim() || '未指定色']
  return parts.join(' · ')
}

function isAutoOptionName(name: string): boolean {
  return /^方案\s*[A-H]$/.test(name) || name.includes(' · ')
}

function defaultBrandId(tech: TechMode): string {
  const list = brandsForTech(tech)
  return list.find((b) => b.popular)?.id || list[0]?.id || 'other'
}

function makeOption(
  index: number,
  tech: TechMode,
  overrides?: Partial<MaterialOption>
): MaterialOption {
  const first = MATERIAL_PRESETS.find((m) => m.tech === tech) || MATERIAL_PRESETS[0]
  const brandId = overrides?.brandId || defaultBrandId(tech)
  const materialId = overrides?.materialId || first.id
  const color = overrides?.color ?? '白'
  const colorHex = overrides?.colorHex ?? '#f5f5f5'
  const base: MaterialOption = {
    id: overrides?.id || newOptionId(),
    name: overrides?.name || '',
    brandId,
    materialId,
    color,
    colorHex,
    pricePerKg: overrides?.pricePerKg ?? first.pricePerKg,
    spoolId: overrides?.spoolId ?? null,
    note: overrides?.note ?? ''
  }
  if (!base.name) {
    base.name =
      index < 8
        ? `方案 ${String.fromCharCode(65 + index)}`
        : buildSpecLabel(base)
  }
  return base
}

function calcCosts(params: {
  weightG: number
  wastePct: number
  pricePerKg: number
  watts: number
  printHours: number
  electricity: number
  wearPerHour: number
  laborMinutes: number
  laborRate: number
  packaging: number
  shipping: number
  failPct: number
  pricingMode: PricingMode
  markupPct: number
  marginPct: number
  minPrice: number
  qty: number
}): QuoteOptionCosts {
  const w = Math.max(0, params.weightG)
  const waste = Math.max(0, params.wastePct) / 100
  const mat = (w * (1 + waste) * (Number(params.pricePerKg) || 0)) / 1000
  const kwh = ((Number(params.watts) || 0) / 1000) * params.printHours
  const elec = kwh * (Number(params.electricity) || 0)
  const wear = params.printHours * (Number(params.wearPerHour) || 0)
  const labor = ((Number(params.laborMinutes) || 0) / 60) * (Number(params.laborRate) || 0)
  const fixed = (Number(params.packaging) || 0) + (Number(params.shipping) || 0)
  const base = mat + elec + wear + labor + fixed
  const fail = Math.max(0, Number(params.failPct) || 0) / 100
  const costWithFail = base * (1 + fail)

  let quote = costWithFail
  if (params.pricingMode === 'markup') {
    quote = costWithFail * (1 + Math.max(0, Number(params.markupPct) || 0) / 100)
  } else {
    const m = Math.min(99.9, Math.max(0, Number(params.marginPct) || 0)) / 100
    quote = m >= 0.999 ? costWithFail : costWithFail / (1 - m)
  }
  const floor = Math.max(0, Number(params.minPrice) || 0)
  const perUnit = Math.max(quote, floor)
  const n = Math.max(1, Math.floor(Number(params.qty) || 1))
  const profit = perUnit - costWithFail
  return {
    mat,
    elec,
    wear,
    labor,
    fixed,
    base,
    costWithFail,
    kwh,
    perUnit,
    profit,
    profitRate: perUnit > 0 ? (profit / perUnit) * 100 : 0,
    grand: perUnit * n,
    appliedFloor: quote < floor
  }
}

function parseGcodeMeta(text: string): { grams?: number; hours?: number; note?: string } {
  const out: { grams?: number; hours?: number; note?: string } = {}
  const lines = text.split(/\r?\n/).slice(0, 8000)

  const gramPatterns = [
    /;\s*filament used \[g\]\s*[:=]\s*([\d.]+)/i,
    /;\s*filament used\s*[:=]\s*([\d.]+)\s*g/i,
    /;\s*total filament used \[g\]\s*[:=]\s*([\d.]+)/i,
    /;\s*filament_weight(?:_g)?\s*[:=]\s*([\d.]+)/i,
    /;\s*filament weight\s*[:=]\s*([\d.]+)/i,
    /;\s*material_weight\s*[:=]\s*([\d.]+)/i,
    /;\s*total filament weight \[g\]\s*[:=]\s*([\d.]+)/i
  ]
  const lengthPatterns = [
    /;\s*filament used \[mm\]\s*[:=]\s*([\d.]+)/i,
    /;\s*filament used\s*[:=]\s*([\d.]+)\s*mm/i,
    /;\s*filament length\s*[:=]\s*([\d.]+)/i
  ]

  for (const line of lines) {
    if (out.grams == null) {
      for (const re of gramPatterns) {
        const m = line.match(re)
        if (m) {
          out.grams = Number(m[1])
          break
        }
      }
    }
    if (out.hours == null) {
      const cura = line.match(/^;\s*TIME\s*[:=]\s*(\d+)/i)
      if (cura) out.hours = Number(cura[1]) / 3600
      const bambu = line.match(/;\s*total estimated time\s*[:=]\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i)
      if (bambu) {
        out.hours =
          (Number(bambu[1] || 0) || 0) +
          (Number(bambu[2] || 0) || 0) / 60 +
          (Number(bambu[3] || 0) || 0) / 3600
      }
      const prusa = line.match(
        /;\s*estimated printing time[^:=]*[:=]\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i
      )
      if (prusa) {
        out.hours =
          (Number(prusa[1] || 0) || 0) * 24 +
          (Number(prusa[2] || 0) || 0) +
          (Number(prusa[3] || 0) || 0) / 60 +
          (Number(prusa[4] || 0) || 0) / 3600
      }
      const orca = line.match(/;\s*model printing time\s*[:=]\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?/i)
      if (orca) {
        out.hours =
          (Number(orca[1] || 0) || 0) +
          (Number(orca[2] || 0) || 0) / 60 +
          (Number(orca[3] || 0) || 0) / 3600
      }
    }
  }

  if (out.grams == null) {
    for (const line of lines) {
      for (const re of lengthPatterns) {
        const m = line.match(re)
        if (m) {
          const mm = Number(m[1])
          const r = 1.75 / 2
          const volCm3 = (Math.PI * r * r * mm) / 1000
          out.grams = volCm3 * 1.24
          out.note = '由线长估算重量（按 PLA 1.75mm / 1.24g·cm⁻³）'
          break
        }
      }
      if (out.grams != null) break
    }
  }

  if (out.grams != null && !Number.isFinite(out.grams)) delete out.grams
  if (out.hours != null && !Number.isFinite(out.hours)) delete out.hours
  return out
}

export function ToolsPage() {
  const saved = useMemo(() => loadDefaults(), [])
  const filamentInit = useFilamentStore((s) => s.init)
  const spools = useFilamentStore((s) => s.spools)
  const filamentLoading = useFilamentStore((s) => s.loading)

  const [tech, setTech] = useState<TechMode>(saved.tech || 'fdm')
  const [options, setOptions] = useState<MaterialOption[]>(() => [
    makeOption(0, saved.tech || 'fdm', {
      materialId: saved.materialId || (saved.tech === 'resin' ? 'resin-std' : 'pla'),
      pricePerKg: saved.pricePerKg ?? (saved.tech === 'resin' ? 90 : 65)
    })
  ])
  const [activeOptionId, setActiveOptionId] = useState(() => options[0]?.id)

  const [weightG, setWeightG] = useState<number | null>(50)
  const [wastePct, setWastePct] = useState(saved.wastePct ?? 10)
  const [hours, setHours] = useState<number | null>(3)
  const [minutesExtra, setMinutesExtra] = useState<number | null>(0)
  const [printerId, setPrinterId] = useState(saved.printerId || 'p1s')
  const [watts, setWatts] = useState(saved.watts ?? 130)
  const [electricity, setElectricity] = useState(saved.electricity ?? 0.6)
  const [wearPerHour, setWearPerHour] = useState(saved.wearPerHour ?? 1.5)
  const [laborMinutes, setLaborMinutes] = useState<number | null>(20)
  const [laborRate, setLaborRate] = useState(saved.laborRate ?? 40)
  const [packaging, setPackaging] = useState(saved.packaging ?? 2)
  const [shipping, setShipping] = useState(saved.shipping ?? 0)
  const [failPct, setFailPct] = useState(saved.failPct ?? 8)
  const [pricingMode, setPricingMode] = useState<PricingMode>(saved.pricingMode || 'markup')
  const [markupPct, setMarkupPct] = useState(saved.markupPct ?? 50)
  const [marginPct, setMarginPct] = useState(saved.marginPct ?? 30)
  const [minPrice, setMinPrice] = useState(saved.minPrice ?? 15)
  const [qty, setQty] = useState<number | null>(1)
  const [customer, setCustomer] = useState('')
  const [jobName, setJobName] = useState('')
  const [gcodeNote, setGcodeNote] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void filamentInit()
  }, [filamentInit])

  const materials = MATERIAL_PRESETS.filter((m) => m.tech === tech)

  const linkedSpools = useMemo(
    () =>
      spools
        .filter((s) => !s.archived && s.tech === tech)
        .slice()
        .sort((a, b) => a.remainGrams - b.remainGrams),
    [spools, tech]
  )

  const printHours = useMemo(() => {
    const h = Number(hours) || 0
    const m = Number(minutesExtra) || 0
    return Math.max(0, h + m / 60)
  }, [hours, minutesExtra])

  const sharedCostParams = useMemo(
    () => ({
      weightG: Number(weightG) || 0,
      wastePct,
      watts,
      printHours,
      electricity,
      wearPerHour,
      laborMinutes: Number(laborMinutes) || 0,
      laborRate,
      packaging,
      shipping,
      failPct,
      pricingMode,
      markupPct,
      marginPct,
      minPrice,
      qty: Math.max(1, Math.floor(Number(qty) || 1))
    }),
    [
      weightG,
      wastePct,
      watts,
      printHours,
      electricity,
      wearPerHour,
      laborMinutes,
      laborRate,
      packaging,
      shipping,
      failPct,
      pricingMode,
      markupPct,
      marginPct,
      minPrice,
      qty
    ]
  )

  const brandOptions = useMemo(
    () =>
      brandsForTech(tech).map((b) => ({
        value: b.id,
        label: b.nameEn && b.nameEn !== b.name ? `${b.name}（${b.nameEn}）` : b.name
      })),
    [tech]
  )

  const optionResults: OptionResult[] = useMemo(
    () =>
      options.map((opt) => {
        const spool = opt.spoolId ? spools.find((s) => s.id === opt.spoolId) : undefined
        const brandLabel = brandLabelOf(opt.brandId)
        const materialLabel = materialTypeLabel(opt.materialId)
        return {
          ...opt,
          brandLabel,
          materialLabel,
          specLabel: buildSpecLabel(opt),
          spoolLabel: spool ? spoolRemainLabel(spool) : undefined,
          costs: calcCosts({ ...sharedCostParams, pricePerKg: opt.pricePerKg })
        }
      }),
    [options, spools, sharedCostParams]
  )

  const activeResult =
    optionResults.find((o) => o.id === activeOptionId) || optionResults[0]

  const cheapestId = useMemo(() => {
    if (!optionResults.length) return null
    let best = optionResults[0]
    for (const o of optionResults) {
      if (o.costs.perUnit < best.costs.perUnit) best = o
    }
    return best.id
  }, [optionResults])

  const patchOption = (id: string, patch: Partial<MaterialOption>) => {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) {
      message.warning(`最多 ${MAX_OPTIONS} 个方案`)
      return
    }
    const next = makeOption(options.length, tech)
    setOptions((prev) => [...prev, next])
    setActiveOptionId(next.id)
  }

  const removeOption = (id: string) => {
    if (options.length <= 1) {
      message.warning('至少保留一个方案')
      return
    }
    setOptions((prev) => {
      const next = prev.filter((o) => o.id !== id)
      if (activeOptionId === id) setActiveOptionId(next[0]?.id)
      return next
    })
  }

  const applySpoolToOption = (optId: string, spoolId: string | null) => {
    if (!spoolId) {
      patchOption(optId, { spoolId: null })
      return
    }
    const s = spools.find((x) => x.id === spoolId)
    if (!s) return
    const preset = matchPresetId(s.material, tech)
    const ppk = pricePerKgFromSpool(s)
    setOptions((prev) =>
      prev.map((o) => {
        if (o.id !== optId) return o
        const next: MaterialOption = {
          ...o,
          spoolId,
          brandId: s.brandId,
          materialId: preset || o.materialId,
          color: s.color,
          colorHex: s.colorHex || o.colorHex,
          pricePerKg: ppk ?? o.pricePerKg
        }
        if (isAutoOptionName(o.name) || /^方案\s*[A-H]$/.test(o.name)) {
          next.name = buildSpecLabel(next)
        }
        return next
      })
    )
    if (ppk != null) message.success(`已填入厂商/颜色与单价 ${ppk} 元/kg`)
    else message.warning('已填入厂商与颜色，该料卷未填采购价，请手动输入单价')
  }

  /** 手动改厂商/材料/颜色时断开料卷绑定，并提示单价需按该规格填写 */
  const patchSpec = (
    optId: string,
    patch: Partial<Pick<MaterialOption, 'brandId' | 'materialId' | 'color' | 'colorHex' | 'pricePerKg'>>,
    opts?: { keepSpool?: boolean; applyPresetPrice?: boolean }
  ) => {
    setOptions((prev) =>
      prev.map((o) => {
        if (o.id !== optId) return o
        const next: MaterialOption = {
          ...o,
          ...patch,
          spoolId: opts?.keepSpool ? o.spoolId : null
        }
        if (opts?.applyPresetPrice && patch.materialId) {
          const m = MATERIAL_PRESETS.find((x) => x.id === patch.materialId)
          if (m && patch.pricePerKg == null) next.pricePerKg = m.pricePerKg
        }
        if (isAutoOptionName(o.name) || /^方案\s*[A-H]$/.test(o.name)) {
          next.name = buildSpecLabel(next)
        }
        return next
      })
    )
  }

  const onPresetForOption = (optId: string, materialId: string) => {
    const m = MATERIAL_PRESETS.find((x) => x.id === materialId)
    patchSpec(
      optId,
      { materialId, pricePerKg: m?.pricePerKg },
      { applyPresetPrice: true }
    )
    message.info('材料类型已更新；不同厂商/颜色请自行核对单价')
  }

  const onPrinter = (id: string) => {
    setPrinterId(id)
    const p = PRINTER_PRESETS.find((x) => x.id === id)
    if (p && id !== 'custom') setWatts(p.watts)
  }

  const onTech = (t: TechMode) => {
    setTech(t)
    setOptions((prev) =>
      prev.map((o, i) =>
        makeOption(i, t, {
          id: o.id,
          note: o.note
        })
      )
    )
    if (t === 'resin') {
      setPrinterId('resin-elegoo')
      setWatts(120)
    }
  }

  const persist = () => {
    const first = options[0]
    saveDefaults({
      tech,
      materialId: first?.materialId || 'pla',
      pricePerKg: first?.pricePerKg ?? 65,
      wastePct,
      printerId,
      watts,
      electricity,
      wearPerHour,
      laborRate,
      packaging,
      shipping,
      failPct,
      pricingMode,
      markupPct,
      marginPct,
      minPrice
    })
    message.success('已保存为本地默认参数')
  }

  const copyQuote = async () => {
    const lines = [
      '【3D 代打报价 · 多方案可选】',
      customer ? `客户：${customer}` : null,
      jobName ? `项目：${jobName}` : null,
      `工艺：${tech === 'resin' ? '光固化' : 'FDM'}`,
      `重量：${weightG ?? 0} g · 时长：${printHours.toFixed(2)} h · 数量：${sharedCostParams.qty}`,
      '',
      '请选择以下任一方案：',
      ...optionResults.map((o, i) => {
        const mark = o.id === cheapestId ? '（最低）' : ''
        const note = o.note ? ` · ${o.note}` : ''
        return `${i + 1}. ${o.name}｜${o.specLabel}｜${o.pricePerKg} 元/kg｜单价 ${yuan(o.costs.perUnit)}｜合计 ${yuan(o.costs.grand)}${mark}${note}`
      }),
      '',
      '回复方案名称或序号即可。'
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(lines)
      message.success('多方案报价已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const exportXlsx = async () => {
    if (!window.electronAPI?.localFiles?.saveAs) {
      message.error('当前环境不支持导出文件')
      return
    }
    setExporting(true)
    try {
      const stamp = new Date()
      const buf = buildQuoteWorkbook({
        time: stamp.toLocaleString('zh-CN'),
        customer,
        jobName,
        tech: tech === 'resin' ? '光固化' : 'FDM',
        weightG: Number(weightG) || 0,
        wastePct,
        printHours,
        watts,
        electricity,
        wearPerHour,
        laborMinutes: Number(laborMinutes) || 0,
        laborRate,
        packaging,
        shipping,
        failPct,
        pricingMode: pricingMode === 'markup' ? '成本加成' : '目标利润率',
        markupPct,
        marginPct,
        minPrice,
        qty: sharedCostParams.qty,
        options: optionResults.map((o, i) => ({
          index: i + 1,
          name: o.name,
          brandLabel: o.brandLabel,
          materialLabel: o.materialLabel,
          color: o.color,
          colorHex: o.colorHex,
          specLabel: o.specLabel,
          pricePerKg: o.pricePerKg,
          spoolLabel: o.spoolLabel,
          note: o.note,
          costs: o.costs
        }))
      })
      const safeName = (jobName || customer || '报价')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 40)
      const fileName = `代打报价_多方案_${safeName}_${stamp.toISOString().slice(0, 10)}.xlsx`
      const res = await window.electronAPI.localFiles.saveAs({ fileName, data: buf })
      if (res.ok && res.path) message.success(`已导出 ${optionResults.length} 个方案：${res.path}`)
      else if (!res.ok) message.info('已取消导出')
    } catch (e) {
      console.error(e)
      message.error('导出失败')
    } finally {
      setExporting(false)
    }
  }

  const onGcodeFile = async (file: File) => {
    try {
      const text = await file.text()
      const meta = parseGcodeMeta(text)
      if (meta.grams != null) setWeightG(Number(meta.grams.toFixed(2)))
      if (meta.hours != null) {
        setHours(Number(meta.hours.toFixed(2)))
        setMinutesExtra(0)
      }
      if (!meta.grams && !meta.hours) {
        message.warning('未能从 G-code 识别重量或时长，请手动填写')
        setGcodeNote('')
      } else {
        const parts = [
          meta.grams != null ? `重量 ${meta.grams.toFixed(1)} g` : null,
          meta.hours != null ? `时长 ${meta.hours.toFixed(2)} h` : null,
          meta.note || null
        ].filter(Boolean)
        setGcodeNote(parts.join(' · '))
        message.success('已从 G-code 填入参数')
      }
    } catch {
      message.error('读取文件失败')
    }
    return false
  }

  return (
    <div className="settings-page quote-page">
      <Typography.Title level={4} className="settings-page-title">
        代打价格计算器
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="settings-page-desc">
        可添加多种耗材方案对比报价，导出 Excel「顾客选型」表供客户勾选；共用打印参数，仅材料单价随方案变化。
      </Typography.Paragraph>

      <div className="quote-layout">
        <div className="quote-form-col">
          <Card className="settings-card quote-form-card" title="共用打印参数">
            <div className="settings-field">
              <Typography.Text strong>工艺</Typography.Text>
              <Radio.Group
                value={tech}
                onChange={(e) => onTech(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'fdm', label: 'FDM 线材' },
                  { value: 'resin', label: '光固化树脂' }
                ]}
              />
            </div>

            <div className="quote-grid-2">
              <div className="settings-field">
                <Typography.Text strong>模型耗材重量（g）</Typography.Text>
                <InputNumber
                  min={0}
                  step={0.1}
                  value={weightG}
                  onChange={(v) => setWeightG(v)}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text strong>损耗 / 支撑（%）</Typography.Text>
                <InputNumber
                  min={0}
                  max={100}
                  value={wastePct}
                  onChange={(v) => setWastePct(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text strong>打印时长（小时）</Typography.Text>
                <InputNumber
                  min={0}
                  step={0.1}
                  value={hours}
                  onChange={(v) => setHours(v)}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text strong>额外分钟</Typography.Text>
                <InputNumber
                  min={0}
                  value={minutesExtra}
                  onChange={(v) => setMinutesExtra(v)}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text strong>数量</Typography.Text>
                <InputNumber min={1} value={qty} onChange={(v) => setQty(v)} style={{ width: '100%' }} />
              </div>
            </div>

            <div className="settings-field">
              <Typography.Text strong>导入切片 G-code（可选）</Typography.Text>
              <Space wrap>
                <Upload
                  accept=".gcode,.gco,.g"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void onGcodeFile(file)
                    return false
                  }}
                >
                  <Button icon={<UploadOutlined />}>选择 G-code</Button>
                </Upload>
                {gcodeNote ? (
                  <Typography.Text type="secondary">{gcodeNote}</Typography.Text>
                ) : (
                  <Typography.Text type="secondary">
                    支持 Orca / Prusa / Bambu / Cura 常见注释
                  </Typography.Text>
                )}
              </Space>
            </div>

            <Divider />

            <Typography.Text strong>设备与电费</Typography.Text>
            <div className="quote-grid-2" style={{ marginTop: 12 }}>
              <div className="settings-field">
                <Typography.Text type="secondary">打印机预设</Typography.Text>
                <Select
                  value={printerId}
                  onChange={onPrinter}
                  style={{ width: '100%' }}
                  options={PRINTER_PRESETS.map((p) => ({
                    value: p.id,
                    label: `${p.label}${p.id === 'custom' ? '' : ` · ${p.watts}W`}`
                  }))}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">平均功率（W）</Typography.Text>
                <InputNumber
                  min={1}
                  value={watts}
                  onChange={(v) => {
                    setWatts(Number(v || 0))
                    setPrinterId('custom')
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">电费（元/kWh）</Typography.Text>
                <InputNumber
                  min={0}
                  step={0.01}
                  value={electricity}
                  onChange={(v) => setElectricity(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">设备折旧（元/小时）</Typography.Text>
                <InputNumber
                  min={0}
                  step={0.1}
                  value={wearPerHour}
                  onChange={(v) => setWearPerHour(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <Divider />

            <Typography.Text strong>人工、杂费与风险</Typography.Text>
            <div className="quote-grid-2" style={{ marginTop: 12 }}>
              <div className="settings-field">
                <Typography.Text type="secondary">人工时长（分钟）</Typography.Text>
                <InputNumber
                  min={0}
                  value={laborMinutes}
                  onChange={(v) => setLaborMinutes(v)}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">人工单价（元/小时）</Typography.Text>
                <InputNumber
                  min={0}
                  value={laborRate}
                  onChange={(v) => setLaborRate(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">包材（元）</Typography.Text>
                <InputNumber
                  min={0}
                  value={packaging}
                  onChange={(v) => setPackaging(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">运费（元）</Typography.Text>
                <InputNumber
                  min={0}
                  value={shipping}
                  onChange={(v) => setShipping(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">失败缓冲（%）</Typography.Text>
                <InputNumber
                  min={0}
                  max={100}
                  value={failPct}
                  onChange={(v) => setFailPct(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">最低单价（元）</Typography.Text>
                <InputNumber
                  min={0}
                  value={minPrice}
                  onChange={(v) => setMinPrice(Number(v || 0))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <Divider />

            <Typography.Text strong>利润定价</Typography.Text>
            <div className="settings-field" style={{ marginTop: 12 }}>
              <Radio.Group
                value={pricingMode}
                onChange={(e) => setPricingMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'markup', label: '成本加成' },
                  { value: 'margin', label: '目标利润率' }
                ]}
              />
            </div>
            {pricingMode === 'markup' ? (
              <div className="settings-field">
                <Typography.Text type="secondary">加成（%）</Typography.Text>
                <InputNumber
                  min={0}
                  value={markupPct}
                  onChange={(v) => setMarkupPct(Number(v || 0))}
                  style={{ width: 200 }}
                />
              </div>
            ) : (
              <div className="settings-field">
                <Typography.Text type="secondary">目标利润率（%）</Typography.Text>
                <InputNumber
                  min={0}
                  max={99}
                  value={marginPct}
                  onChange={(v) => setMarginPct(Number(v || 0))}
                  style={{ width: 200 }}
                />
              </div>
            )}

            <Divider />

            <div className="quote-grid-2">
              <div className="settings-field">
                <Typography.Text type="secondary">客户名（选填）</Typography.Text>
                <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
              </div>
              <div className="settings-field">
                <Typography.Text type="secondary">项目名（选填）</Typography.Text>
                <Input value={jobName} onChange={(e) => setJobName(e.target.value)} />
              </div>
            </div>

            <Space wrap>
              <Button type="primary" icon={<CalculatorOutlined />} onClick={persist}>
                保存默认参数
              </Button>
              <Button
                icon={<DeleteOutlined />}
                onClick={() => {
                  localStorage.removeItem(STORAGE_KEY)
                  localStorage.removeItem('printer-monitor.quote-calc.v1')
                  message.success('已清除本地默认')
                }}
              >
                清除默认
              </Button>
            </Space>
          </Card>

          <Card
            className="settings-card quote-options-card"
            title="耗材方案（顾客可选）"
            extra={
              <Button type="link" icon={<PlusOutlined />} onClick={addOption}>
                添加方案
              </Button>
            }
            style={{ marginTop: 14 }}
          >
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              每个方案需标明厂商与颜色（不同品牌、不同颜色单价不同）；可从耗材库存一键带入。导出后顾客按规格选型。
            </Typography.Paragraph>

            <div className="quote-options-list">
              {options.map((opt, idx) => {
                const active = opt.id === (activeOptionId || optionResults[0]?.id)
                const priced = optionResults.find((r) => r.id === opt.id)
                return (
                  <div
                    key={opt.id}
                    className={`quote-option-row${active ? ' is-active' : ''}`}
                    onClick={() => setActiveOptionId(opt.id)}
                  >
                    <div className="quote-option-head">
                      <div className="quote-option-title">
                        <span
                          className="quote-color-swatch"
                          style={{ background: opt.colorHex || '#888' }}
                          title={opt.color}
                        />
                        <Typography.Text strong>
                          {idx + 1}. {opt.name}
                          {opt.id === cheapestId ? (
                            <span className="quote-option-badge">最低价</span>
                          ) : null}
                        </Typography.Text>
                      </div>
                      <Space size={4}>
                        <Typography.Text type="success">
                          {priced ? yuan(priced.costs.perUnit) : '—'}
                        </Typography.Text>
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={options.length <= 1}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeOption(opt.id)
                          }}
                        />
                      </Space>
                    </div>

                    <Typography.Text type="secondary" className="quote-option-spec">
                      {priced?.specLabel || buildSpecLabel(opt)} · {opt.pricePerKg} 元/kg
                    </Typography.Text>

                    <div className="quote-grid-2" onClick={(e) => e.stopPropagation()}>
                      <div className="settings-field">
                        <Typography.Text type="secondary">方案名称（给顾客看）</Typography.Text>
                        <Input
                          value={opt.name}
                          onChange={(e) => patchOption(opt.id, { name: e.target.value })}
                          placeholder="如：拓竹 PLA 白"
                        />
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">备注（可选）</Typography.Text>
                        <Input
                          value={opt.note}
                          onChange={(e) => patchOption(opt.id, { note: e.target.value })}
                          placeholder="如：丝绸光泽、耐高温"
                        />
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">联动料卷（带入厂商/颜色/单价）</Typography.Text>
                        <Select
                          allowClear
                          showSearch
                          placeholder={
                            filamentLoading
                              ? '加载中…'
                              : linkedSpools.length
                                ? '选择库存料卷'
                                : '暂无料卷'
                          }
                          value={opt.spoolId ?? undefined}
                          onChange={(v) => applySpoolToOption(opt.id, v ?? null)}
                          style={{ width: '100%' }}
                          optionFilterProp="label"
                          options={linkedSpools.map((s) => {
                            const ppk = pricePerKgFromSpool(s)
                            const brand = brandLabelOf(s.brandId)
                            const mat =
                              FILAMENT_MATERIALS.find((m) => m.id === s.material)?.label ||
                              s.material
                            return {
                              value: s.id,
                              label: `${brand} · ${mat} · ${s.color}（剩 ${Math.round(s.remainGrams)} g）${ppk != null ? ` · ${ppk} 元/kg` : ''}`
                            }
                          })}
                        />
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">厂商</Typography.Text>
                        <Select
                          showSearch
                          value={opt.brandId}
                          onChange={(v) => {
                            patchSpec(opt.id, { brandId: v })
                            message.info('厂商已变更，请按该品牌实际采购价调整单价')
                          }}
                          style={{ width: '100%' }}
                          optionFilterProp="label"
                          options={brandOptions}
                        />
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">材料类型</Typography.Text>
                        <Select
                          value={opt.materialId}
                          onChange={(v) => onPresetForOption(opt.id, v)}
                          style={{ width: '100%' }}
                          options={materials.map((m) => ({
                            value: m.id,
                            label: `${m.label}（参考 ${m.pricePerKg} 元/kg）`
                          }))}
                        />
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">颜色</Typography.Text>
                        <div className="quote-color-row">
                          <div className="quote-color-presets">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c.hex + c.label}
                                type="button"
                                title={c.label}
                                className={`spool-color-preset${opt.colorHex === c.hex ? ' active' : ''}`}
                                style={{ background: c.hex }}
                                onClick={() => {
                                  patchSpec(opt.id, { color: c.label, colorHex: c.hex })
                                  message.info('颜色已变更，请按该颜色实际采购价调整单价')
                                }}
                              />
                            ))}
                          </div>
                          <Input
                            value={opt.color}
                            onChange={(e) => patchSpec(opt.id, { color: e.target.value })}
                            placeholder="颜色名"
                            style={{ maxWidth: 120 }}
                          />
                        </div>
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">
                          材料单价（元/kg，按厂商+颜色填写）
                        </Typography.Text>
                        <InputNumber
                          min={0}
                          step={1}
                          value={opt.pricePerKg}
                          onChange={(v) => patchOption(opt.id, { pricePerKg: Number(v || 0) })}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="settings-field">
                        <Typography.Text type="secondary">合计</Typography.Text>
                        <div className="quote-option-grand">
                          {priced ? yuan(priced.costs.grand) : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <Card className="settings-card quote-result-card" title="方案对比与明细">
          {activeResult ? (
            <>
              <div className="quote-hero">
                <div className="quote-hero-label">当前方案 · {activeResult.name}</div>
                <div className="quote-hero-spec">
                  <span
                    className="quote-color-swatch"
                    style={{ background: activeResult.colorHex || '#888' }}
                  />
                  {activeResult.specLabel}
                </div>
                <div className="quote-hero-price">{yuan(activeResult.costs.perUnit)}</div>
                <div className="quote-hero-sub">
                  × {sharedCostParams.qty} 件 = <strong>{yuan(activeResult.costs.grand)}</strong>
                </div>
              </div>

              {activeResult.costs.appliedFloor ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="该方案已套用最低单价"
                />
              ) : null}

              <Table
                size="small"
                pagination={false}
                rowKey="id"
                className="quote-compare-table"
                dataSource={optionResults}
                onRow={(record) => ({
                  onClick: () => setActiveOptionId(record.id),
                  className: record.id === activeResult.id ? 'quote-row-active' : undefined
                })}
                columns={[
                  {
                    title: '方案',
                    dataIndex: 'name',
                    width: 72,
                    ellipsis: true,
                    render: (name: string, row: OptionResult) => (
                      <span>
                        {name}
                        {row.id === cheapestId ? (
                          <span className="quote-option-badge">低</span>
                        ) : null}
                      </span>
                    )
                  },
                  {
                    title: '厂商',
                    dataIndex: 'brandLabel',
                    width: 64,
                    ellipsis: true
                  },
                  {
                    title: '颜色',
                    dataIndex: 'color',
                    width: 72,
                    render: (color: string, row: OptionResult) => (
                      <span className="quote-table-color">
                        <span
                          className="quote-color-swatch sm"
                          style={{ background: row.colorHex || '#888' }}
                        />
                        {color || '—'}
                      </span>
                    )
                  },
                  {
                    title: '材料',
                    dataIndex: 'materialLabel',
                    width: 64,
                    ellipsis: true
                  },
                  {
                    title: '单价',
                    width: 72,
                    align: 'right',
                    render: (_: unknown, row: OptionResult) => yuan(row.costs.perUnit)
                  },
                  {
                    title: '合计',
                    width: 72,
                    align: 'right',
                    render: (_: unknown, row: OptionResult) => yuan(row.costs.grand)
                  }
                ]}
              />

              <Divider style={{ margin: '14px 0' }} />

              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                成本明细 · {activeResult.name}
              </Typography.Text>
              <div className="quote-breakdown">
                <div>
                  <span>材料费</span>
                  <span>{yuan(activeResult.costs.mat)}</span>
                </div>
                <div>
                  <span>电费（{activeResult.costs.kwh.toFixed(3)} kWh）</span>
                  <span>{yuan(activeResult.costs.elec)}</span>
                </div>
                <div>
                  <span>设备折旧</span>
                  <span>{yuan(activeResult.costs.wear)}</span>
                </div>
                <div>
                  <span>人工</span>
                  <span>{yuan(activeResult.costs.labor)}</span>
                </div>
                <div>
                  <span>包材 / 运费</span>
                  <span>{yuan(activeResult.costs.fixed)}</span>
                </div>
                <div>
                  <span>含失败缓冲</span>
                  <span>{yuan(activeResult.costs.costWithFail)}</span>
                </div>
                <div className="quote-breakdown-strong">
                  <span>预计利润 / 件</span>
                  <span>
                    {yuan(activeResult.costs.profit)}（{activeResult.costs.profitRate.toFixed(1)}%）
                  </span>
                </div>
              </div>
            </>
          ) : null}

          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Button type="primary" block icon={<CopyOutlined />} onClick={() => void copyQuote()}>
              复制多方案报价（给顾客）
            </Button>
            <Button
              block
              icon={<FileExcelOutlined />}
              loading={exporting}
              onClick={() => void exportXlsx()}
            >
              导出 Excel（顾客选型 + 对比）
            </Button>
          </Space>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            导出含「顾客选型」（无利润明细，可勾选方案）、「方案对比」（店主成本）、「共用参数」。多方案时不自动扣库存，待顾客选定后再在耗材管理中调整。
          </Typography.Paragraph>
        </Card>
      </div>
    </div>
  )
}
