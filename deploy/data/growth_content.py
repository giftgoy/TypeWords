"""原创双语成长素材，CC0-1.0。每词前两句训练，后四句保留测试。"""


def word(key, meaning, lines):
    examples = []
    for index, (en, cn) in enumerate(lines):
        token = f"[{key}]"
        if en.count(token) != 1:
            raise ValueError(f"Invalid target in {key}: {en}")
        examples.append({"id": f"v1:{key}:{index}", "text": en.replace(token, key),
                         "cloze": en.replace(token, "______"), "translation": cn, "training": index < 2})
    return {"id": key, "word": key, "meaning": meaning, "examples": examples}


PACKS = [
    {"id": "life", "name": "基础生活", "description": "生活中的具体事物，适合从简单短句开始。", "words": [
        word("coat", "外套", [
            ("Please put on your [coat].", "请穿上你的外套。"),
            ("His [coat] is on the chair.", "他的外套在椅子上。"),
            ("Your [coat] has two deep pockets.", "你的外套有两个很深的口袋。"),
            ("She buttoned up her [coat] before going outside.", "她出门前扣好了外套的扣子。"),
            ("This thick [coat] keeps me warm.", "这件厚外套让我感到暖和。"),
            ("The sleeves of his [coat] were wet.", "他的外套袖子湿了。")]),
        word("ticket", "票；车票", [
            ("Show your [ticket] at the gate.", "在入口处出示你的票。"),
            ("I bought a train [ticket] today.", "我今天买了一张火车票。"),
            ("The inspector checked my train [ticket].", "检票员检查了我的火车票。"),
            ("This [ticket] is for the early bus.", "这张票是早班巴士的。"),
            ("Your seat number is printed on the [ticket].", "你的座位号印在票上。"),
            ("The concert [ticket] is in my bag.", "音乐会的票在我的包里。")]),
        word("umbrella", "雨伞", [
            ("Take an [umbrella] when it rains.", "下雨时带把伞。"),
            ("My red [umbrella] is by the door.", "我的红伞在门旁。"),
            ("She opened her [umbrella] in the rain.", "她在雨中撑开了伞。"),
            ("He held an open [umbrella] above his head.", "他把一把撑开的伞举在头顶。"),
            ("The wind turned her [umbrella] inside out.", "风把她的雨伞吹翻了。"),
            ("An [umbrella] can protect you from rain.", "雨伞可以为你挡雨。")]),
        word("kitchen", "厨房", [
            ("We cook dinner in the [kitchen].", "我们在厨房做晚饭。"),
            ("The [kitchen] smells of fresh bread.", "厨房里有新鲜面包的香味。"),
            ("Wash the cups in the [kitchen].", "去厨房洗杯子。"),
            ("She keeps the pots in the [kitchen].", "她把锅放在厨房里。"),
            ("Dad is making soup in the [kitchen].", "爸爸正在厨房做汤。"),
            ("Our [kitchen] is next to the dining room.", "我们的厨房在餐厅旁边。")]),
        word("chair", "椅子", [
            ("Please sit on this [chair].", "请坐在这把椅子上。"),
            ("There is a [chair] beside the desk.", "书桌旁有一把椅子。"),
            ("This wooden [chair] has a broken leg.", "这把木椅的一条腿坏了。"),
            ("He pulled out a [chair] for me.", "他为我拉出了一把椅子。"),
            ("Move that [chair] closer to the table.", "把那把椅子移近桌子一些。"),
            ("The baby is sitting in a high [chair].", "宝宝正坐在高脚餐椅里。")]),
    ]},
    {"id": "daily", "name": "日常表达", "description": "借用、决定和准备等常用动作，句子稍长一些。", "words": [
        word("borrow", "借入；借用", [
            ("May I [borrow] your pen?", "我可以借用你的笔吗？"),
            ("We can [borrow] books from the library.", "我们可以从图书馆借书。"),
            ("I need to [borrow] a ladder from a neighbor.", "我需要向邻居借一把梯子。"),
            ("Can she [borrow] your bicycle for an hour?", "她可以借用你的自行车一小时吗？"),
            ("Students may [borrow] a camera for this project.", "学生可以为这个项目借用一台相机。"),
            ("You can [borrow] my jacket and return it tomorrow.", "你可以借我的夹克，明天再还。")]),
        word("decide", "决定", [
            ("We must [decide] where to eat.", "我们必须决定去哪里吃饭。"),
            ("I will [decide] after reading the letter.", "我读完信后会做决定。"),
            ("Please [decide] which route we should take.", "请决定我们应该走哪条路线。"),
            ("They will [decide] whether to move next week.", "他们下周会决定是否搬家。"),
            ("We need time to [decide] what to do.", "我们需要时间决定做什么。"),
            ("You should [decide] before the shop closes.", "你应该在商店关门前做决定。")]),
        word("improve", "改善；提高", [
            ("Practice can [improve] your spelling.", "练习可以提高你的拼写能力。"),
            ("We want to [improve] our service.", "我们想改善服务。"),
            ("Reading every week can [improve] your vocabulary.", "每周阅读可以增加你的词汇量。"),
            ("Better lights will [improve] safety on this road.", "更好的照明会提高这条路的安全性。"),
            ("This exercise may [improve] your balance.", "这项练习可能会改善你的平衡能力。"),
            ("The team hopes to [improve] the design.", "团队希望改进这个设计。")]),
        word("prepare", "准备", [
            ("Let us [prepare] dinner together.", "让我们一起准备晚饭。"),
            ("I need to [prepare] for the test.", "我需要为考试做准备。"),
            ("Please [prepare] a short speech for the meeting.", "请为会议准备一段简短的发言。"),
            ("We should [prepare] the room before guests arrive.", "我们应该在客人到达前准备好房间。"),
            ("She will [prepare] lunch for the children.", "她将为孩子们准备午饭。"),
            ("He got up early to [prepare] for the trip.", "他早起为旅行做准备。")]),
        word("invite", "邀请", [
            ("I will [invite] my friends to dinner.", "我会邀请朋友来吃晚饭。"),
            ("May we [invite] you to our school?", "我们可以邀请你来学校吗？"),
            ("They plan to [invite] a singer to the event.", "他们计划邀请一位歌手参加活动。"),
            ("Please [invite] your neighbor to the picnic.", "请邀请邻居参加野餐。"),
            ("We would like to [invite] her to speak.", "我们想邀请她来讲话。"),
            ("You can [invite] two guests to the celebration.", "你可以邀请两位客人参加庆祝活动。")]),
    ]},
    {"id": "ideas", "name": "思考与表达", "description": "围绕目标、比较和建议练习较抽象的常用动词。", "words": [
        word("achieve", "实现；达成", [
            ("We can [achieve] our goal together.", "我们可以一起实现目标。"),
            ("It takes time to [achieve] lasting change.", "实现持久的改变需要时间。"),
            ("Small daily steps can help you [achieve] success.", "每天的一小步可以帮助你取得成功。"),
            ("The team worked hard to [achieve] this result.", "团队为取得这个结果付出了努力。"),
            ("Clear plans help us [achieve] better results.", "明确的计划帮助我们取得更好的结果。"),
            ("She hopes to [achieve] a fair agreement.", "她希望达成一项公平的协议。")]),
        word("avoid", "避免", [
            ("Leave early to [avoid] the traffic.", "早点出发以避开拥堵。"),
            ("We should [avoid] wasting water.", "我们应该避免浪费水。"),
            ("Wear gloves to [avoid] touching the hot surface.", "戴上手套，避免碰到发烫的表面。"),
            ("Read the instructions to [avoid] common mistakes.", "阅读说明以避免常见错误。"),
            ("They chose another path to [avoid] the crowd.", "他们选择了另一条路来避开人群。"),
            ("We can [avoid] delays by planning ahead.", "提前规划可以让我们避免延误。")]),
        word("compare", "比较", [
            ("Let us [compare] these two pictures.", "让我们比较这两幅图片。"),
            ("You should [compare] prices before buying.", "购买前你应该比较价格。"),
            ("We need to [compare] the results of both tests.", "我们需要比较两次测试的结果。"),
            ("Please [compare] the two lists for differences.", "请比较这两份清单，找出差异。"),
            ("Students will [compare] life in two cities.", "学生们将比较两座城市的生活。"),
            ("It is useful to [compare] several possible solutions.", "比较几个可能的解决方案是有用的。")]),
        word("consider", "考虑", [
            ("Please [consider] my suggestion.", "请考虑我的建议。"),
            ("We should [consider] the cost first.", "我们应该先考虑费用。"),
            ("Take a moment to [consider] the other option.", "花一点时间考虑另一个选择。"),
            ("They will [consider] whether the plan is safe.", "他们将考虑这项计划是否安全。"),
            ("You need to [consider] everyone's needs.", "你需要考虑每个人的需求。"),
            ("We must [consider] the effect on local people.", "我们必须考虑对当地居民的影响。")]),
        word("suggest", "建议；提议", [
            ("I [suggest] taking a short break.", "我建议稍作休息。"),
            ("Can you [suggest] a good book?", "你能推荐一本好书吗？"),
            ("Please [suggest] a time for our next meeting.", "请提议下次会议的时间。"),
            ("I would [suggest] trying the simpler method first.", "我建议先试试较简单的方法。"),
            ("Could you [suggest] a place for lunch?", "你能推荐一个吃午饭的地方吗？"),
            ("They may [suggest] a different way to solve it.", "他们可能会建议另一种解决方法。")]),
    ]},
]
WORDS = {item["id"]: item for pack in PACKS for item in pack["words"]}
