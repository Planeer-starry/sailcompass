"""离线演示翻译：术语表 + 句式模板，不调用任何模型。

用于未配置文本模型时，仍能给用户展示目标语言的术语对照、待译条文和保留不译项。
"""
import re

LANGUAGES = ["English", "Deutsch", "Français", "Español", "日本語", "한국어", "العربية", "ไทย"]
LANG_LABEL = {
    "English": "英语", "Deutsch": "德语", "Français": "法语", "Español": "西班牙语",
    "日本語": "日语", "한국어": "韩语", "العربية": "阿拉伯语", "ไทย": "泰语",
}

# (中文, English, Deutsch, Français, Español, 日本語, 한국어, العربية, ไทย)
TERMS = [
    ("产品", "Product", "Produkt", "Produit", "Producto", "製品", "제품", "منتج", "สินค้า"),
    ("保温杯", "Vacuum Bottle", "Thermosflasche", "Bouteille isotherme", "Botella térmica", "保温ボトル", "보온병", "زجاجة حرارية", "กระติกน้ำ"),
    ("不锈钢", "Stainless Steel", "Edelstahl", "Acier inoxydable", "Acero inoxidable", "ステンレス", "스테인리스", "فولاذ مقاوم للصدأ", "สแตนเลส"),
    ("容量", "Capacity", "Fassungsvermögen", "Capacité", "Capacidad", "容量", "용량", "السعة", "ความจุ"),
    ("尺寸", "Size", "Größe", "Taille", "Tamaño", "サイズ", "크기", "الحجم", "ขนาด"),
    ("重量", "Weight", "Gewicht", "Poids", "Peso", "重量", "무게", "الوزن", "น้ำหนัก"),
    ("材质", "Material", "Material", "Matière", "Material", "素材", "재질", "المادة", "วัสดุ"),
    ("颜色", "Color", "Farbe", "Couleur", "Color", "色", "색상", "اللون", "สี"),
    ("认证", "Certification", "Zertifizierung", "Certification", "Certificación", "認証", "인증", "شهادة", "การรับรอง"),
    ("型号", "Model", "Modell", "Modèle", "Modelo", "型番", "모델", "الطراز", "รุ่น"),
    ("说明书", "Manual", "Gebrauchsanweisung", "Manuel", "Manual", "取扱説明書", "설명서", "دليل الاستخدام", "คู่มือ"),
    ("合同", "Contract", "Vertrag", "Contrat", "Contrato", "契約", "계약", "عقد", "สัญญา"),
    ("商品", "Product", "Produkt", "Produit", "Producto", "商品", "상품", "منتج", "สินค้า"),
    ("上架", "Listing", "Listing", "Annonce", "Publicación", "出品", "등록", "إدراج", "การลงขาย"),
    ("标题", "Title", "Titel", "Titre", "Título", "タイトル", "제목", "العنوان", "หัวข้อ"),
    ("五点描述", "Bullet Points", "Fünf Merkmale", "Cinq points", "Cinco puntos", "5つの特徴", "핵심 5가지", "النقاط الخمس", "ห้าจุดเด่น"),
    ("关键词", "Keywords", "Schlüsselwörter", "Mots-clés", "Palabras clave", "キーワード", "키워드", "الكلمات المفتاحية", "คีย์เวิร์ด"),
    ("详情页", "Detail Page", "Detailseite", "Page produit", "Página de detalles", "詳細ページ", "상세 페이지", "صفحة التفاصيل", "หน้ารายละเอียด"),
    ("包装", "Packaging", "Verpackung", "Emballage", "Embalaje", "包装", "포장", "التغليف", "บรรจุภัณฑ์"),
    ("标签", "Label", "Etikett", "Étiquette", "Etiqueta", "ラベル", "라벨", "ملصق", "ฉลาก"),
    ("品牌", "Brand", "Marke", "Marque", "Marca", "ブランド", "브랜드", "العلامة التجارية", "แบรนด์"),
    ("商标", "Trademark", "Marke", "Marque déposée", "Marca registrada", "商標", "상표", "العلامة التجارية", "เครื่องหมายการค้า"),
    ("保修", "Warranty", "Garantie", "Garantie", "Garantía", "保証", "보증", "الضمان", "การรับประกัน"),
    ("售后", "After-sales", "Kundendienst", "Service après-vente", "Posventa", "アフターサービス", "애프터서비스", "خدمة ما بعد البيع", "บริการหลังการขาย"),
    ("发货", "Shipping", "Versand", "Expédition", "Envío", "発送", "발송", "الشحن", "การจัดส่ง"),
    ("物流", "Logistics", "Logistik", "Logistique", "Logística", "物流", "물류", "الخدمات اللوجستية", "โลจิสติกส์"),
    ("清关", "Customs Clearance", "Zollabfertigung", "Dédouanement", "Despacho aduanero", "通関", "통관", "التخليص الجمركي", "พิธีการศุลกากร"),
    ("关税", "Tariff", "Zoll", "Droits de douane", "Arancel", "関税", "관세", "الرسوم الجمركية", "ภาษีศุลกากร"),
    ("认证编号", "Certificate No.", "Zertifikatsnummer", "N° de certificat", "N.º de certificado", "認証番号", "인증번호", "رقم الشهادة", "หมายเลขใบรับรอง"),
    ("插头", "Plug", "Stecker", "Prise", "Enchufe", "プラグ", "플러그", "القابس", "ปลั๊ก"),
    ("电压", "Voltage", "Spannung", "Tension", "Voltaje", "電圧", "전압", "الجهد", "แรงดันไฟฟ้า"),
    ("功率", "Power", "Leistung", "Puissance", "Potencia", "電力", "전력", "الطاقة", "กำลังไฟ"),
    ("电池", "Battery", "Akku", "Batterie", "Batería", "バッテリー", "배터리", "بطارية", "แบตเตอรี่"),
    ("无线", "Wireless", "Drahtlos", "Sans fil", "Inalámbrico", "ワイヤレス", "무선", "لاسلكي", "ไร้สาย"),
    ("防水", "Waterproof", "Wasserfest", "Étanche", "Impermeable", "防水", "방수", "مقاوم للماء", "กันน้ำ"),
    ("防漏", "Leak-proof", "Auslaufsicher", "Anti-fuite", "Antifugas", "漏れ防止", "누수 방지", "مقاوم للتسرب", "กันรั่ว"),
    ("耐用", "Durable", "Langlebig", "Durable", "Duradero", "耐久性", "내구성", "متين", "ทนทาน"),
    ("便携", "Portable", "Tragbar", "Portable", "Portátil", "携帯用", "휴대용", "محمول", "พกพา"),
    ("环保", "Eco-friendly", "Umweltfreundlich", "Écologique", "Ecológico", "環境に優しい", "친환경", "صديق للبيئة", "เป็นมิตรต่อสิ่งแวดล้อม"),
    ("食品级", "Food-grade", "Lebensmittelecht", "Qualité alimentaire", "Apto para alimentos", "食品グレード", "식품 등급", "آمن غذائياً", "เกรดอาหาร"),
    ("不含BPA", "BPA-free", "BPA-frei", "Sans BPA", "Libre de BPA", "BPAフリー", "BPA 프리", "خالٍ من BPA", "ปลอด BPA"),
    ("使用场景", "Use Case", "Anwendungsfall", "Cas d'utilisation", "Caso de uso", "使用シーン", "사용场景", "حالة الاستخدام", "กรณีการใช้งาน"),
    ("户外", "Outdoor", "Outdoor", "Extérieur", "Exterior", "アウトドア", "야외", "في الهواء الطلق", "กลางแจ้ง"),
    ("家居", "Home", "Home", "Maison", "Hogar", "ホーム", "홈", "المنزل", "บ้าน"),
    ("礼品", "Gift", "Geschenk", "Cadeau", "Regalo", "ギフト", "선물", "هدية", "ของขวัญ"),
    ("厨房", "Kitchen", "Küche", "Cuisine", "Cocina", "キッチン", "주방", "المطبخ", "ครัว"),
    ("办公", "Office", "Büro", "Bureau", "Oficina", "オフィス", "사무실", "المكتب", "สำนักงาน"),
    ("旅行", "Travel", "Reisen", "Voyage", "Viaje", "旅行", "여행", "السفر", "การเดินทาง"),
    ("运动", "Sports", "Sport", "Sport", "Deporte", "スポーツ", "스포츠", "الرياضة", "กีฬา"),
    ("母婴", "Baby & Mother", "Baby & Mutter", "Bébé et maman", "Bebé y madre", "ベビー・マタニティ", "유아·산모", "الأم والطفل", "แม่และเด็ก"),
    ("宠物", "Pets", "Haustiere", "Animaux domestiques", "Mascotas", "ペット", "반려동물", "الحيوانات الأليفة", "สัตว์เลี้ยง"),
    ("美妆", "Beauty", "Beauty", "Beauté", "Belleza", "美容", "뷰티", "الجمال", "ความงาม"),
    ("电子", "Electronics", "Elektronik", "Électronique", "Electrónica", "電子", "전자", "إلكترونيات", "อิเล็กทรอนิกส์"),
    ("家具", "Furniture", "Möbel", "Meubles", "Muebles", "家具", "가구", "الأثاث", "เฟอร์นิเจอร์"),
    ("服装", "Clothing", "Kleidung", "Vêtements", "Ropa", "衣類", "의류", "الملابس", "เสื้อผ้า"),
    ("鞋", "Shoes", "Schuhe", "Chaussures", "Zapatos", "靴", "신발", "أحذية", "รองเท้า"),
    ("箱包", "Bags", "Taschen", "Sacs", "Bolsos", "バッグ", "가방", "حقائب", "กระเป๋า"),
    ("食品", "Food", "Lebensmittel", "Aliments", "Alimentos", "食品", "식품", "طعام", "อาหาร"),
    ("饮料", "Beverage", "Getränk", "Boisson", "Bebida", "飲料", "음료", "مشروب", "เครื่องดื่ม"),
    ("汽车", "Auto", "Auto", "Automobile", "Automóvil", "自動車", "자동차", "سيارة", "รถยนต์"),
    ("工具", "Tools", "Werkzeuge", "Outils", "Herramientas", "工具", "도구", "أدوات", "เครื่องมือ"),
    ("医疗", "Medical", "Medizinisch", "Médical", "Médico", "医療", "의료", "طبي", "การแพทย์"),
    ("合规", "Compliance", "Compliance", "Conformité", "Cumplimiento", "コンプライアンス", "규정 준수", "الامتثال", "การปฏิบัติตามกฎ"),
    ("检测报告", "Test Report", "Prüfbericht", "Rapport d'essai", "Informe de prueba", "検査報告書", "시험 성적서", "تقرير الاختبار", "รายงานทดสอบ"),
    ("供应商", "Supplier", "Lieferant", "Fournisseur", "Proveedor", "サプライヤー", "공급업체", "المورد", "ผู้จัดจำหน่าย"),
    ("采购", "Procurement", "Beschaffung", "Achat", "Compra", "調達", "조달", "الشراء", "การจัดซื้อ"),
    ("批发", "Wholesale", "Großhandel", "Vente en gros", "Mayoreo", "卸売", "도매", "البيع بالجملة", "การขายส่ง"),
    ("零售", "Retail", "Einzelhandel", "Détail", "Menudeo", "小売", "소매", "البيع بالتجزئة", "การขายปลีก"),
    ("样品", "Sample", "Muster", "Échantillon", "Muestra", "サンプル", "샘플", "عينة", "ตัวอย่าง"),
    ("订单", "Order", "Bestellung", "Commande", "Pedido", "注文", "주문", "طلب", "คำสั่งซื้อ"),
    ("交期", "Lead Time", "Lieferzeit", "Délai", "Plazo de entrega", "納期", "납기", "وقت التسليم", "ระยะเวลาจัดส่ง"),
]

FIELD_LABELS = [
    ("标题", "Title", "Titel", "Titre", "Título", "タイトル", "제목", "العنوان", "หัวข้อ"),
    ("五点描述", "Bullet Points", "Fünf Merkmale", "Cinq points", "Cinco puntos", "5つの特徴", "핵심 5가지", "النقاط الخمس", "ห้าจุดเด่น"),
    ("关键词", "Keywords", "Schlüsselwörter", "Mots-clés", "Palabras clave", "キーワード", "키워드", "الكلمات المفتاحية", "คีย์เวิร์ด"),
    ("材质", "Material", "Material", "Matière", "Material", "素材", "재질", "المادة", "วัสดุ"),
    ("尺寸", "Size", "Größe", "Taille", "Tamaño", "サイズ", "크기", "الحجم", "ขนาด"),
    ("认证", "Certification", "Zertifizierung", "Certification", "Certificación", "認証", "인증", "شهادة", "การรับรอง"),
]


def _index(lang):
    return LANGUAGES.index(lang) + 1 if lang in LANGUAGES else 1


def _translation(term, lang):
    return term[_index(lang)]


def _detected_terms(text):
    found = [t for t in TERMS if t[0] in text]
    if not found:
        found = TERMS[:10]
    return found


def _keep_items(text):
    keys = set()
    for pattern in [r"\b[A-Z]{2,}[-_ ]?\d{2,}\b", r"\d+(?:\.\d+)?\s?(?:ml|L|cm|mm|kg|g|W|V|mAh|h|小时|寸)\b"]:
        keys.update(re.findall(pattern, text, flags=re.I))
    return sorted(keys)


def generate_demo_translation(text, doc_type="商品上架文案", languages=None, terms=""):
    text = (text or "").strip()
    languages = [x for x in (languages or []) if x]
    if not languages:
        languages = ["English"]
    lines = [
        "演示模式：仅生成术语表与占位结构，配置模型后输出完整译文",
        "",
        f"**材料类型**：{doc_type or '商品上架文案'}",
        "",
    ]
    detected = _detected_terms(text)
    paragraphs = [p.strip() for p in re.split(r"\n|\r", text) if p.strip()]
    keep = _keep_items(text)
    for lang in languages:
        if lang not in LANGUAGES:
            lines += [f"## {lang}", "", "> 该语言未内置演示术语，以下用英文对照占位。", ""]
            lang = "English"
        lines += [f"## {lang}", "", "### 术语对照表", "", "| 中文 | 译文 |", "|---|---|"]
        for row in FIELD_LABELS:
            lines.append(f"| {row[0]} | {_translation(row, lang)} |")
        for row in detected:
            lines.append(f"| {row[0]} | {_translation(row, lang)} |")
        lines += ["", "### 待译条文清单", ""]
        for i, para in enumerate(paragraphs, 1):
            lines.append(f"{i}. {para}")
            lines.append(f"   - 待翻译（{LANG_LABEL.get(lang, lang)}）：{_translation(('标题',) + tuple(['Title', 'Titel', 'Titre', 'Título', 'タイトル', '제목', 'العنوان', 'หัวข้อ']), lang)}占位，配置模型后输出完整译文")
        lines += ["", "### 保留不译项", ""]
        if keep:
            for item in keep:
                lines.append(f"- `{item}`：型号/认证编号/单位，保持原样")
        else:
            lines.append("- 未识别到明确的型号、认证编号或单位；仍需人工确认并保留原样")
        if terms.strip():
            lines += ["", "**用户指定术语/写法**：" + terms.strip()]
        lines.append("")
    return "\n".join(lines)