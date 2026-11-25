"""演示模式 · 按用户填写的信息组装四段结果，不调用任何模型。

覆盖：10+ 品类、6+ 平台、8+ 市场、8+ 语言；不出现固定的单一示例。
"""
import json

from . import tools

MARKETS = {
    "美国": {"profile": "体量大、竞争激烈，平台规则和售后要求成熟", "cert": "FDA / FCC / UL（按品类）", "local": "英文文案、英寸/磅等本地单位、售后响应要快"},
    "德国": {"profile": "对认证、标签和环保要求严格，消费者看重品质与说明", "cert": "CE / REACH / LFGB（食品接触类）", "local": "德语、CE 标识、包装与说明书要完整"},
    "英国": {"profile": "规则相对独立，平台合规与税务要求要单独确认", "cert": "UKCA（部分品类可用 CE 过渡）", "local": "英式英语、UKCA 标识、VAT 合规"},
    "法国": {"profile": "审美与包装要求高，消费者关注材质和环保", "cert": "CE / REACH", "local": "法语、包装审美、环保说明"},
    "意大利": {"profile": "重视设计与品牌感，价格敏感度中等", "cert": "CE / REACH", "local": "意大利语、设计感、尺寸说明"},
    "西班牙": {"profile": "价格与实用性并重，南欧物流时效要说明", "cert": "CE / REACH", "local": "西班牙语、实用场景、物流时效"},
    "荷兰": {"profile": "英语接受度高，重视环保和简洁说明", "cert": "CE / REACH", "local": "荷兰语/英语、环保、简洁包装"},
    "日本": {"profile": "对细节、包装、使用说明和售后要求高", "cert": "PSE / TELEC（无线类）", "local": "日语、尺寸精确、说明书细致"},
    "韩国": {"profile": "重视外观、速度和本地售后", "cert": "KC（按品类）", "local": "韩语、快速发货、本地客服"},
    "加拿大": {"profile": "与美国相近，但双语和本地认证要单独确认", "cert": "ISED / CSA（按品类）", "local": "英语/法语、双语标签、本地认证"},
    "澳大利亚": {"profile": "地广人稀，物流时效和售后距离是重点", "cert": "RCM（电气类）", "local": "英语、RCM 标识、偏远地区运费"},
    "沙特阿拉伯": {"profile": "认证与标签要求严格，宗教与本地文化要注意", "cert": "SASO / SABER", "local": "阿拉伯语、SASO 文件、本地文化"},
    "阿联酋": {"profile": "消费力强，重视品牌和快速交付", "cert": "ESMA / ECAS（按品类）", "local": "阿拉伯语/英语、品牌感、快速交付"},
    "巴西": {"profile": "关税与物流复杂，认证和本地税务要提前确认", "cert": "ANATEL / INMETRO（按品类）", "local": "葡萄牙语、税号、物流时效"},
    "墨西哥": {"profile": "价格敏感，平台规则和本地认证要确认", "cert": "NOM（按品类）", "local": "西班牙语、价格力、本地认证"},
    "波兰": {"profile": "价格与时效并重，CE/REACH 和本地语言要确认", "cert": "CE / REACH", "local": "波兰语、价格力、物流时效"},
    "瑞典": {"profile": "重视环保、设计和简洁说明", "cert": "CE / REACH", "local": "瑞典语/英语、环保、简洁"},
    "新加坡": {"profile": "英语接受度高，重视时效和品牌", "cert": "按品类确认", "local": "英语、快速交付、品牌感"},
    "马来西亚": {"profile": "价格敏感，本地语言和促销要适配", "cert": "按品类确认", "local": "马来语/英语、促销、物流"},
    "泰国": {"profile": "价格敏感，社媒和促销影响大", "cert": "按品类确认", "local": "泰语、促销、场景化"},
    "越南": {"profile": "价格敏感，物流和本地化说明重要", "cert": "按品类确认", "local": "越南语、价格力、物流"},
    "菲律宾": {"profile": "英语接受度高，价格和促销敏感", "cert": "按品类确认", "local": "英语/菲律宾语、促销、物流"},
    "印度尼西亚": {"profile": "人口大、价格敏感，本地语言和认证要确认", "cert": "按品类确认", "local": "印尼语、价格力、本地认证"},
    "新西兰": {"profile": "英语市场，重视品质和售后", "cert": "RCM（电气类）", "local": "英语、品质、售后"},
    "印度": {"profile": "价格敏感、规则复杂，认证和税务要提前确认", "cert": "BIS（按品类）", "local": "英语、价格力、本地认证"},
    "以色列": {"profile": "英语/希伯来语，重视安全和认证", "cert": "按品类确认", "local": "英语/希伯来语、安全、认证"},
    "智利": {"profile": "西语市场，价格和物流时效重要", "cert": "按品类确认", "local": "西班牙语、价格、物流"},
    "哥伦比亚": {"profile": "西语市场，价格敏感，本地支付要说明", "cert": "按品类确认", "local": "西班牙语、价格、支付"},
    "南非": {"profile": "英语市场，物流距离和售后是关键", "cert": "按品类确认", "local": "英语、物流、售后"},
    "尼日利亚": {"profile": "价格敏感，支付和物流要说明", "cert": "按品类确认", "local": "英语、价格、支付"},
    "全球市场": {"profile": "多市场并行，先选一个主站点再逐步扩展", "cert": "按目标国确认", "local": "先统一英文，再按站点补本地语言"},
}

CATEGORIES = {
    "3C电子": {"directions": ["参数透明", "兼容性说明", "安全认证"], "risks": ["电池运输", "无线认证", "电压标识"]},
    "家居生活": {"directions": ["材质安全", "日常场景", "易清洁"], "risks": ["食品接触材料", "标签说明", "承重标注"]},
    "家具家居": {"directions": ["尺寸承重", "材质环保", "安装说明"], "risks": ["甲醛释放", "承重标注", "木材检疫"]},
    "户外运动": {"directions": ["耐用性", "便携性", "场景适配"], "risks": ["材质耐久", "承重安全", "防晒说明"]},
    "户外用品": {"directions": ["耐用性", "便携性", "场景适配"], "risks": ["材质耐久", "承重安全", "防晒说明"]},
    "美妆个护": {"directions": ["成分透明", "使用步骤", "肤质适配"], "risks": ["成分标签", "微生物指标", "功效宣称"]},
    "母婴玩具": {"directions": ["安全材质", "年龄适配", "小零件风险"], "risks": ["CPC 认证", "小零件", "邻苯二甲酸盐"]},
    "宠物用品": {"directions": ["材料安全", "尺寸适配", "清洁便利"], "risks": ["材料安全", "尺寸说明", "咬合强度"]},
    "服饰鞋包": {"directions": ["面料成分", "尺码说明", "场景搭配"], "risks": ["纤维成分", "阻燃要求", "偶氮染料"]},
    "皮具箱包": {"directions": ["材质说明", "容量尺寸", "五金耐用"], "risks": ["材质标注", "甲醛/异味", "承重说明"]},
    "服装鞋帽": {"directions": ["面料成分", "尺码说明", "场景搭配"], "risks": ["纤维成分", "阻燃要求", "偶氮染料"]},
    "食品饮料": {"directions": ["配料透明", "保质期", "储存方式"], "risks": ["食品接触材料", "保质期标签", "成分标注"]},
    "汽车用品": {"directions": ["车型适配", "安装说明", "耐用性"], "risks": ["阻燃要求", "适配说明", "运输安全"]},
    "汽车配件": {"directions": ["车型适配", "安装说明", "耐用性"], "risks": ["阻燃要求", "适配说明", "运输安全"]},
    "五金工具": {"directions": ["材质强度", "规格清晰", "安全使用"], "risks": ["材质标注", "承重说明", "包装防护"]},
    "办公文具": {"directions": ["规格清晰", "使用场景", "环保材料"], "risks": ["材质安全", "标签说明", "儿童使用提示"]},
    "医疗器械": {"directions": ["注册资质", "适用范围", "使用说明"], "risks": ["FDA 510(k)/CE MDR", "临床证据", "标签与说明书"]},
    "珠宝饰品": {"directions": ["材质标注", "尺寸说明", "送礼场景"], "risks": ["贵金属标注", "镍释放", "尺寸说明"]},
    "运动健身": {"directions": ["承重安全", "材质耐用", "训练场景"], "risks": ["承重标注", "材质安全", "使用说明"]},
    "园艺工具": {"directions": ["材质耐用", "使用场景", "安全防护"], "risks": ["材质标注", "锋利边缘", "包装防护"]},
    "其他": {"directions": ["核心功能", "使用场景", "参数透明"], "risks": ["认证要求", "标签说明", "宣传用语"]},
}

PLATFORMS = {
    "Amazon": {"rule": "标题建议 ≤200 字符，五点描述 + 后台关键词；图片和合规文件要求严格", "price": "中高价位，重视评价、FBA 和售后", "tone": "专业、参数清楚"},
    "TikTok Shop": {"rule": "短句、场景化、视频封面；标题和卖点要口语化", "price": "中低价，冲动消费", "tone": "场景、直接"},
    "Shopee": {"rule": "促销词、低价、本地化；标题关键词适度堆叠", "price": "价格敏感，促销驱动", "tone": "轻松、利益点前置"},
    "Temu": {"rule": "价格力优先，标题简短，图片直接", "price": "低价走量", "tone": "直接、卖点短"},
    "AliExpress": {"rule": "国际关键词、规格清晰、物流时效要写", "price": "中低价，重视运费", "tone": "参数 + 场景"},
    "eBay": {"rule": "规格、成色、配件和兼容性要写清", "price": "中低价，二手/配件心智", "tone": "参数、兼容性"},
    "Walmart": {"rule": "美国本地合规、标题简洁、图片规范", "price": "中价位，重视性价比", "tone": "清晰、可信"},
    "Lazada": {"rule": "东南亚本地化、促销词、语言适配", "price": "价格敏感", "tone": "轻快、利益点"},
    "Mercado Libre": {"rule": "西语/葡语、分期和物流信息要写", "price": "价格敏感，分期常见", "tone": "本地化、直接"},
    "Rakuten": {"rule": "日本本地化、店铺评分和售后说明要完整", "price": "中高价，重视信誉", "tone": "细致、礼貌"},
    "Coupang": {"rule": "韩国本地化、火箭配送和退换说明要清楚", "price": "中价位，速度优先", "tone": "直接、快速"},
    "独立站": {"rule": "品牌故事、SEO 标题、详情页结构化", "price": "中高价，重视品牌", "tone": "品牌、信任"},
    "其他": {"rule": "先确认平台标题、图片、合规和售后规则", "price": "按平台定位", "tone": "清晰、可信"},
}

LANGUAGES = {
    "English": "英语", "Español": "西班牙语", "Deutsch": "德语", "Français": "法语",
    "Italiano": "意大利语", "Português": "葡萄牙语", "日本語": "日语", "한국어": "韩语",
    "العربية": "阿拉伯语", "ไทย": "泰语", "Tiếng Việt": "越南语", "Bahasa Indonesia": "印尼语",
    "Bahasa Melayu": "马来语", "Türkçe": "土耳其语", "Nederlands": "荷兰语", "Polski": "波兰语",
}


def _pick(mapping, key, fallback="其他"):
    if key in mapping:
        return mapping[key]
    for name, value in mapping.items():
        if name != fallback and (name in key or key in name):
            return value
    return mapping[fallback]


def _points(info):
    raw = (info.get("selling_points") or "").replace("，", "、").replace(",", "、").replace("；", "、").replace(";", "、").replace("/", "、")
    points = [x.strip() for x in raw.split("、") if x.strip()]
    category = _pick(CATEGORIES, info.get("category") or "其他")
    return points or list(category["directions"])


def _params(info):
    params = (info.get("params") or "").strip()
    return params or "以产品页实际参数为准"


def build_demo_result(info):
    info = info or {}
    product = (info.get("product") or "你的产品").strip()
    category_name = (info.get("category") or "其他").strip() or "其他"
    platform_name = (info.get("platform") or "其他").strip() or "其他"
    market_name = (info.get("market") or "全球市场").strip() or "全球市场"
    languages = [x for x in (info.get("languages") or []) if x]

    category = _pick(CATEGORIES, category_name)
    platform = _pick(PLATFORMS, platform_name)
    market = _pick(MARKETS, market_name)
    cert_list = tools.certifications_for(market_name, category_name)
    cert_text = "、".join(cert_list)
    points = _points(info)
    params = _params(info)

    insight = "\n".join([
        "## 目标市场判断",
        f"- 目标市场：{market_name}。{market['profile']}。",
        f"- 目标平台：{platform_name}。{platform['price']}。",
        f"- 产品：{product}，属于「{category_name}」。下面的判断按你填写的信息组装，不调用模型。",
        "",
        "## 目标人群与场景",
        "- 优先人群：有明确使用场景、会主动比较参数和评价的买家。",
        f"- 典型场景：{points[0]}、{points[1] if len(points) > 1 else '日常使用'}、{points[2] if len(points) > 2 else '送礼/替换'}。",
        f"- 不建议一开始铺所有人群，先用「{points[0]}」打一个主场景。",
        "",
        "## 卖点方向",
        f"- 第一卖点：{points[0]}。",
        f"- 第二卖点：{points[1] if len(points) > 1 else '使用场景'}。",
        f"- 第三卖点：{points[2] if len(points) > 2 else '参数透明'}。",
        f"- 参数表达：{params}。",
        "",
        "## 平台与定价参考",
        f"- {platform_name}：{platform['rule']}。",
        f"- 定价：{platform['price']}；先参考同类目价格带，不要凭空写具体数字。",
        "",
        "## 本地化要点",
        f"- {market_name}：{market['local']}。",
        f"- 语言：{'、'.join(languages) if languages else '中文为主，外语可去 05 多语翻译'}。",
        "",
        "## 风险提示",
        f"- {market_name}常见认证：{cert_text}；具体是否适用要按品类和平台确认。",
        f"- 品类风险：{'、'.join(category['risks'][:2])}。",
        "- 演示数据只做方向判断，具体销量、份额和价格要另行查证。",
    ])

    listing = "\n".join([
        "## 中文上架文案",
        "",
        "### 标题",
        f"{product}｜{points[0]}｜{market_name}市场适配",
        "",
        "### 五点描述",
        f"- {points[0]}：按实际产品说明写清楚，不夸大。",
        f"- {points[1] if len(points) > 1 else '使用场景'}：写具体使用场景，方便买家对号入座。",
        f"- {points[2] if len(points) > 2 else '参数透明'}：把关键参数放在详情页，不用模糊词。",
        f"- 参数：{params}。",
        f"- 售后：按 {platform_name} 规则写清发货、退换和响应时间。",
        "",
        "### 详情描述",
        f"{product}适合{market_name}市场有「{points[0]}」需求的买家。按 {platform_name} 规则组织标题和五点：{platform['rule']}。描述里只写你提供的卖点和参数，不添加未确认的认证、数字或促销承诺。",
        "",
        "### 后台关键词",
        f"{product}、{category_name}、{market_name}、{points[0]}、{points[1] if len(points) > 1 else '使用场景'}",
        "",
        "### 翻译提示",
        "当前为中文演示文案。需要外语，请到 05 多语翻译选择目标语言；演示模式不编造外语正文。",
    ])

    word_check = tools.check_text(listing, platform_name)
    rows = [
        {
            "item": f"{market_name}认证与合规文件",
            "risk_level": "红",
            "basis": f"{market_name}市场常见要求：{cert_text}；是否适用要按品类和平台确认。",
            "action": f"确认 {cert_text} 是否适用，准备检测报告或符合性声明，后台备查。",
            "need_verify": "是",
            "action_status": "待处理",
        },
        {
            "item": f"{platform_name}平台规则",
            "risk_level": "黄",
            "basis": f"{platform_name}：{platform['rule']}。",
            "action": "按平台规则检查标题、图片、关键词、售后和合规文件。",
            "need_verify": "是",
            "action_status": "待处理",
        },
        {
            "item": category["risks"][0],
            "risk_level": "红",
            "basis": f"「{category_name}」常见风险项，平台或市场可能要求证明材料。",
            "action": f"补充 {category['risks'][0]} 相关说明或检测，不能确认就不要在文案里宣称。",
            "need_verify": "是",
            "action_status": "待处理",
        },
        {
            "item": category["risks"][1] if len(category["risks"]) > 1 else "标签与说明书",
            "risk_level": "黄",
            "basis": f"「{category_name}」上架前常见检查项。",
            "action": "核对标签、说明书、参数单位；缺失的标「待确认」，不要编造。",
            "need_verify": "是",
            "action_status": "待处理",
        },
        {
            "item": "宣传用语与绝对化表述",
            "risk_level": "黄",
            "basis": "平台通常限制 best / No.1 / 100% / guaranteed 等绝对化用语。",
            "action": "逐条检查标题、五点和详情，删除无依据的绝对化表述。",
            "need_verify": "是",
            "action_status": "待处理",
        },
    ]

    hit_words = [h["word"] for h in word_check.get("hits", [])]
    trademark_hits = tools.check_trademarks(listing)
    rows.append({
        "item": "文案违禁词检查",
        "risk_level": "红" if word_check.get("banned_hits") else ("黄" if word_check.get("risky_hits") else "绿"),
        "basis": ("命中：" + "、".join(hit_words[:6])) if hit_words else f"演示词库 {word_check.get('version')} 未命中",
        "action": "删除或替换命中词，改为可验证的客观描述" if hit_words else "保持客观描述，不上绝对化用语",
        "need_verify": "是" if hit_words else "否",
        "action_status": "待处理",
    })

    rows.append({
        "item": "商标与品牌词风险",
        "risk_level": "红" if trademark_hits else "绿",
        "basis": ("命中知名品牌词：" + "、".join(trademark_hits[:5])) if trademark_hits else "未命中知名品牌词（仍需确认授权与商标）",
        "action": "删除品牌词或取得授权证明；不要蹭品牌名/logo" if trademark_hits else "继续做商标检索，避免近似品牌",
        "need_verify": "是" if trademark_hits else "否",
        "action_status": "待处理",
    })

    quality = "\n".join([
        "## 检查结论",
        f"三份结果围绕「{product} / {market_name} / {platform_name}」展开，整体可用；合规体检还有红项和需人工核实项。",
        "",
        "## 发现的冲突",
        f"- 市场洞察把「{points[0]}」作为第一卖点，Listing 标题和五点已覆盖，口径一致。",
        f"- 合规体检的「{rows[0]['item']}」在 Listing 里没有提前规避，建议在详情页补一句「认证情况以实际文件为准」。",
        f"- 参数「{params}」需要在详情页和后台属性保持一致，避免前后不一致。",
        "",
        "## 判断风险",
        f"- {market_name}的认证要求：{cert_text}，需确认是否适用。",
        f"- {category_name}的常见风险：{'、'.join(category['risks'][:2])}，不能凭经验直接写「已通过」。",
        (f"- 违禁词库命中：{'、'.join(hit_words[:6])}；已写入合规表，请逐条确认。" if hit_words else f"- 违禁词库 {word_check.get('version')} 未命中。"),
        "",
        "## 改进建议",
        "1. 先处理合规体检第一条红项，再导出交付。",
        f"2. 标题按 {platform_name} 规则压缩，保留「{points[0]}」主卖点。",
        "3. 所有数字、认证、型号以实际资料为准，没有的标「待确认」。",
    ])

    return {
        "insight": insight,
        "listing": listing,
        "compliance": rows,
        "compliance_raw": json.dumps(rows, ensure_ascii=False, indent=2),
        "quality": quality,
        "tool_trace": {
            "word_check": word_check,
            "trademark_check": trademark_hits,
            "vision": False,
            "image": False,
            "export": False,
        },
        "demo": True,
        "demo_notice": "当前为演示数据：结果按你填写的信息组装，不是 AI 生成，仅用于接入模型前的功能测试。配置 API 后可获得真实答案。",
    }