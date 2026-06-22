/**
 * Content filter — PII + SECRETS detector (the safety core of the marketplace).
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 2.
 *
 * Pure + dependency-free: scan text → findings[]. No DB, no I/O. Lives in `lib/`
 * so every vector is exhaustively unit-testable and the routes layer (the `/scan`
 * endpoint) can call it over a pack's PLAINTEXT members and persist only the
 * REDACTED findings.
 *
 * Severity contract (founder decision, FAIL-CLOSED):
 *   - every `secret_*` category is severity:'reject'  → hasSecrets:true  → pack REJECTED.
 *   - every `pii_*`    category is severity:'hold'     → hasPii:true      → pack HELD BACK.
 *   - the Shannon-entropy fallback is severity:'hold'  (an unknown high-entropy blob is
 *     suspicious but not a recognised credential — it must NOT hard-reject on its own).
 *   - `sample` is REDACTED (first 4 chars + '…' + '(' + length + ')'). The raw secret
 *     value NEVER appears in a finding, so a moderation row can never persist a live
 *     credential. `index` is the byte offset of the match in the source text.
 *
 * `hasSecrets` / `hasPii` are derived from finding SEVERITY (reject / hold) so the
 * persisted, redacted findings re-derive the exact same flags downstream (see
 * `resolveGate` in pack-marketplace.routes.ts, which reads `findings[].severity`).
 *
 * A false negative here is a leaked credential shipping inside a listed pack, so the
 * recognised-secret set below is deliberately broad; the entropy fallback is the
 * catch-all for unknown shapes.
 */

// ─────────── Public contract ───────────

export type FilterCategory =
  | 'secret_private_key'
  | 'secret_seed_phrase'
  | 'secret_api_key'
  | 'secret_jwt'
  | 'secret_password'
  | 'pii_email'
  | 'pii_phone'
  | 'pii_ssn'
  | 'pii_credit_card';

export interface Finding {
  category: FilterCategory;
  severity: 'reject' | 'hold';
  /** REDACTED preview: first 4 chars + '…' + '(' + length + ')'. Never the raw value. */
  sample: string;
  /** Byte offset of the matched value in the scanned text. */
  index: number;
}

export interface FilterResult {
  findings: Finding[];
  hasSecrets: boolean;
  hasPii: boolean;
}

// ─────────── Redaction ───────────

/**
 * Redact a matched secret to `<first4>…(<length>)`. The body is never echoed, but the
 * length is disclosed so an operator can eyeball "that's a 64-char key" without seeing it.
 * For values shorter than 4 chars the whole prefix is just the value (still no body to leak).
 */
function redact(raw: string): string {
  const head = raw.slice(0, 4);
  return `${head}…(${raw.length})`;
}

// ─────────── BIP39 wordlist (canonical English 2048) ───────────
// Bundled in-module (not imported) to keep this file pure + dependency-free. A
// mnemonic is ≥12 consecutive whitespace-separated tokens ALL drawn from this set.

const BIP39_WORDS = new Set<string>([
  "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
  "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual", "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
  "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent", "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
  "alcohol", "alert", "alien", "all", "alley", "allow", "almost", "alone", "alpha", "already", "also", "alter", "always", "amateur", "amazing", "among",
  "amount", "amused", "analyst", "anchor", "ancient", "anger", "angle", "angry", "animal", "ankle", "announce", "annual", "another", "answer", "antenna", "antique",
  "anxiety", "any", "apart", "apology", "appear", "apple", "approve", "april", "arch", "arctic", "area", "arena", "argue", "arm", "armed", "armor",
  "army", "around", "arrange", "arrest", "arrive", "arrow", "art", "artefact", "artist", "artwork", "ask", "aspect", "assault", "asset", "assist", "assume",
  "asthma", "athlete", "atom", "attack", "attend", "attitude", "attract", "auction", "audit", "august", "aunt", "author", "auto", "autumn", "average", "avocado",
  "avoid", "awake", "aware", "away", "awesome", "awful", "awkward", "axis", "baby", "bachelor", "bacon", "badge", "bag", "balance", "balcony", "ball",
  "bamboo", "banana", "banner", "bar", "barely", "bargain", "barrel", "base", "basic", "basket", "battle", "beach", "bean", "beauty", "because", "become",
  "beef", "before", "begin", "behave", "behind", "believe", "below", "belt", "bench", "benefit", "best", "betray", "better", "between", "beyond", "bicycle",
  "bid", "bike", "bind", "biology", "bird", "birth", "bitter", "black", "blade", "blame", "blanket", "blast", "bleak", "bless", "blind", "blood",
  "blossom", "blouse", "blue", "blur", "blush", "board", "boat", "body", "boil", "bomb", "bone", "bonus", "book", "boost", "border", "boring",
  "borrow", "boss", "bottom", "bounce", "box", "boy", "bracket", "brain", "brand", "brass", "brave", "bread", "breeze", "brick", "bridge", "brief",
  "bright", "bring", "brisk", "broccoli", "broken", "bronze", "broom", "brother", "brown", "brush", "bubble", "buddy", "budget", "buffalo", "build", "bulb",
  "bulk", "bullet", "bundle", "bunker", "burden", "burger", "burst", "bus", "business", "busy", "butter", "buyer", "buzz", "cabbage", "cabin", "cable",
  "cactus", "cage", "cake", "call", "calm", "camera", "camp", "can", "canal", "cancel", "candy", "cannon", "canoe", "canvas", "canyon", "capable",
  "capital", "captain", "car", "carbon", "card", "cargo", "carpet", "carry", "cart", "case", "cash", "casino", "castle", "casual", "cat", "catalog",
  "catch", "category", "cattle", "caught", "cause", "caution", "cave", "ceiling", "celery", "cement", "census", "century", "cereal", "certain", "chair", "chalk",
  "champion", "change", "chaos", "chapter", "charge", "chase", "chat", "cheap", "check", "cheese", "chef", "cherry", "chest", "chicken", "chief", "child",
  "chimney", "choice", "choose", "chronic", "chuckle", "chunk", "churn", "cigar", "cinnamon", "circle", "citizen", "city", "civil", "claim", "clap", "clarify",
  "claw", "clay", "clean", "clerk", "clever", "click", "client", "cliff", "climb", "clinic", "clip", "clock", "clog", "close", "cloth", "cloud",
  "clown", "club", "clump", "cluster", "clutch", "coach", "coast", "coconut", "code", "coffee", "coil", "coin", "collect", "color", "column", "combine",
  "come", "comfort", "comic", "common", "company", "concert", "conduct", "confirm", "congress", "connect", "consider", "control", "convince", "cook", "cool", "copper",
  "copy", "coral", "core", "corn", "correct", "cost", "cotton", "couch", "country", "couple", "course", "cousin", "cover", "coyote", "crack", "cradle",
  "craft", "cram", "crane", "crash", "crater", "crawl", "crazy", "cream", "credit", "creek", "crew", "cricket", "crime", "crisp", "critic", "crop",
  "cross", "crouch", "crowd", "crucial", "cruel", "cruise", "crumble", "crunch", "crush", "cry", "crystal", "cube", "culture", "cup", "cupboard", "curious",
  "current", "curtain", "curve", "cushion", "custom", "cute", "cycle", "dad", "damage", "damp", "dance", "danger", "daring", "dash", "daughter", "dawn",
  "day", "deal", "debate", "debris", "decade", "december", "decide", "decline", "decorate", "decrease", "deer", "defense", "define", "defy", "degree", "delay",
  "deliver", "demand", "demise", "denial", "dentist", "deny", "depart", "depend", "deposit", "depth", "deputy", "derive", "describe", "desert", "design", "desk",
  "despair", "destroy", "detail", "detect", "develop", "device", "devote", "diagram", "dial", "diamond", "diary", "dice", "diesel", "diet", "differ", "digital",
  "dignity", "dilemma", "dinner", "dinosaur", "direct", "dirt", "disagree", "discover", "disease", "dish", "dismiss", "disorder", "display", "distance", "divert", "divide",
  "divorce", "dizzy", "doctor", "document", "dog", "doll", "dolphin", "domain", "donate", "donkey", "donor", "door", "dose", "double", "dove", "draft",
  "dragon", "drama", "drastic", "draw", "dream", "dress", "drift", "drill", "drink", "drip", "drive", "drop", "drum", "dry", "duck", "dumb",
  "dune", "during", "dust", "dutch", "duty", "dwarf", "dynamic", "eager", "eagle", "early", "earn", "earth", "easily", "east", "easy", "echo",
  "ecology", "economy", "edge", "edit", "educate", "effort", "egg", "eight", "either", "elbow", "elder", "electric", "elegant", "element", "elephant", "elevator",
  "elite", "else", "embark", "embody", "embrace", "emerge", "emotion", "employ", "empower", "empty", "enable", "enact", "end", "endless", "endorse", "enemy",
  "energy", "enforce", "engage", "engine", "enhance", "enjoy", "enlist", "enough", "enrich", "enroll", "ensure", "enter", "entire", "entry", "envelope", "episode",
  "equal", "equip", "era", "erase", "erode", "erosion", "error", "erupt", "escape", "essay", "essence", "estate", "eternal", "ethics", "evidence", "evil",
  "evoke", "evolve", "exact", "example", "excess", "exchange", "excite", "exclude", "excuse", "execute", "exercise", "exhaust", "exhibit", "exile", "exist", "exit",
  "exotic", "expand", "expect", "expire", "explain", "expose", "express", "extend", "extra", "eye", "eyebrow", "fabric", "face", "faculty", "fade", "faint",
  "faith", "fall", "false", "fame", "family", "famous", "fan", "fancy", "fantasy", "farm", "fashion", "fat", "fatal", "father", "fatigue", "fault",
  "favorite", "feature", "february", "federal", "fee", "feed", "feel", "female", "fence", "festival", "fetch", "fever", "few", "fiber", "fiction", "field",
  "figure", "file", "film", "filter", "final", "find", "fine", "finger", "finish", "fire", "firm", "first", "fiscal", "fish", "fit", "fitness",
  "fix", "flag", "flame", "flash", "flat", "flavor", "flee", "flight", "flip", "float", "flock", "floor", "flower", "fluid", "flush", "fly",
  "foam", "focus", "fog", "foil", "fold", "follow", "food", "foot", "force", "forest", "forget", "fork", "fortune", "forum", "forward", "fossil",
  "foster", "found", "fox", "fragile", "frame", "frequent", "fresh", "friend", "fringe", "frog", "front", "frost", "frown", "frozen", "fruit", "fuel",
  "fun", "funny", "furnace", "fury", "future", "gadget", "gain", "galaxy", "gallery", "game", "gap", "garage", "garbage", "garden", "garlic", "garment",
  "gas", "gasp", "gate", "gather", "gauge", "gaze", "general", "genius", "genre", "gentle", "genuine", "gesture", "ghost", "giant", "gift", "giggle",
  "ginger", "giraffe", "girl", "give", "glad", "glance", "glare", "glass", "glide", "glimpse", "globe", "gloom", "glory", "glove", "glow", "glue",
  "goat", "goddess", "gold", "good", "goose", "gorilla", "gospel", "gossip", "govern", "gown", "grab", "grace", "grain", "grant", "grape", "grass",
  "gravity", "great", "green", "grid", "grief", "grit", "grocery", "group", "grow", "grunt", "guard", "guess", "guide", "guilt", "guitar", "gun",
  "gym", "habit", "hair", "half", "hammer", "hamster", "hand", "happy", "harbor", "hard", "harsh", "harvest", "hat", "have", "hawk", "hazard",
  "head", "health", "heart", "heavy", "hedgehog", "height", "hello", "helmet", "help", "hen", "hero", "hidden", "high", "hill", "hint", "hip",
  "hire", "history", "hobby", "hockey", "hold", "hole", "holiday", "hollow", "home", "honey", "hood", "hope", "horn", "horror", "horse", "hospital",
  "host", "hotel", "hour", "hover", "hub", "huge", "human", "humble", "humor", "hundred", "hungry", "hunt", "hurdle", "hurry", "hurt", "husband",
  "hybrid", "ice", "icon", "idea", "identify", "idle", "ignore", "ill", "illegal", "illness", "image", "imitate", "immense", "immune", "impact", "impose",
  "improve", "impulse", "inch", "include", "income", "increase", "index", "indicate", "indoor", "industry", "infant", "inflict", "inform", "inhale", "inherit", "initial",
  "inject", "injury", "inmate", "inner", "innocent", "input", "inquiry", "insane", "insect", "inside", "inspire", "install", "intact", "interest", "into", "invest",
  "invite", "involve", "iron", "island", "isolate", "issue", "item", "ivory", "jacket", "jaguar", "jar", "jazz", "jealous", "jeans", "jelly", "jewel",
  "job", "join", "joke", "journey", "joy", "judge", "juice", "jump", "jungle", "junior", "junk", "just", "kangaroo", "keen", "keep", "ketchup",
  "key", "kick", "kid", "kidney", "kind", "kingdom", "kiss", "kit", "kitchen", "kite", "kitten", "kiwi", "knee", "knife", "knock", "know",
  "lab", "label", "labor", "ladder", "lady", "lake", "lamp", "language", "laptop", "large", "later", "latin", "laugh", "laundry", "lava", "law",
  "lawn", "lawsuit", "layer", "lazy", "leader", "leaf", "learn", "leave", "lecture", "left", "leg", "legal", "legend", "leisure", "lemon", "lend",
  "length", "lens", "leopard", "lesson", "letter", "level", "liar", "liberty", "library", "license", "life", "lift", "light", "like", "limb", "limit",
  "link", "lion", "liquid", "list", "little", "live", "lizard", "load", "loan", "lobster", "local", "lock", "logic", "lonely", "long", "loop",
  "lottery", "loud", "lounge", "love", "loyal", "lucky", "luggage", "lumber", "lunar", "lunch", "luxury", "lyrics", "machine", "mad", "magic", "magnet",
  "maid", "mail", "main", "major", "make", "mammal", "man", "manage", "mandate", "mango", "mansion", "manual", "maple", "marble", "march", "margin",
  "marine", "market", "marriage", "mask", "mass", "master", "match", "material", "math", "matrix", "matter", "maximum", "maze", "meadow", "mean", "measure",
  "meat", "mechanic", "medal", "media", "melody", "melt", "member", "memory", "mention", "menu", "mercy", "merge", "merit", "merry", "mesh", "message",
  "metal", "method", "middle", "midnight", "milk", "million", "mimic", "mind", "minimum", "minor", "minute", "miracle", "mirror", "misery", "miss", "mistake",
  "mix", "mixed", "mixture", "mobile", "model", "modify", "mom", "moment", "monitor", "monkey", "monster", "month", "moon", "moral", "more", "morning",
  "mosquito", "mother", "motion", "motor", "mountain", "mouse", "move", "movie", "much", "muffin", "mule", "multiply", "muscle", "museum", "mushroom", "music",
  "must", "mutual", "myself", "mystery", "myth", "naive", "name", "napkin", "narrow", "nasty", "nation", "nature", "near", "neck", "need", "negative",
  "neglect", "neither", "nephew", "nerve", "nest", "net", "network", "neutral", "never", "news", "next", "nice", "night", "noble", "noise", "nominee",
  "noodle", "normal", "north", "nose", "notable", "note", "nothing", "notice", "novel", "now", "nuclear", "number", "nurse", "nut", "oak", "obey",
  "object", "oblige", "obscure", "observe", "obtain", "obvious", "occur", "ocean", "october", "odor", "off", "offer", "office", "often", "oil", "okay",
  "old", "olive", "olympic", "omit", "once", "one", "onion", "online", "only", "open", "opera", "opinion", "oppose", "option", "orange", "orbit",
  "orchard", "order", "ordinary", "organ", "orient", "original", "orphan", "ostrich", "other", "outdoor", "outer", "output", "outside", "oval", "oven", "over",
  "own", "owner", "oxygen", "oyster", "ozone", "pact", "paddle", "page", "pair", "palace", "palm", "panda", "panel", "panic", "panther", "paper",
  "parade", "parent", "park", "parrot", "party", "pass", "patch", "path", "patient", "patrol", "pattern", "pause", "pave", "payment", "peace", "peanut",
  "pear", "peasant", "pelican", "pen", "penalty", "pencil", "people", "pepper", "perfect", "permit", "person", "pet", "phone", "photo", "phrase", "physical",
  "piano", "picnic", "picture", "piece", "pig", "pigeon", "pill", "pilot", "pink", "pioneer", "pipe", "pistol", "pitch", "pizza", "place", "planet",
  "plastic", "plate", "play", "please", "pledge", "pluck", "plug", "plunge", "poem", "poet", "point", "polar", "pole", "police", "pond", "pony",
  "pool", "popular", "portion", "position", "possible", "post", "potato", "pottery", "poverty", "powder", "power", "practice", "praise", "predict", "prefer", "prepare",
  "present", "pretty", "prevent", "price", "pride", "primary", "print", "priority", "prison", "private", "prize", "problem", "process", "produce", "profit", "program",
  "project", "promote", "proof", "property", "prosper", "protect", "proud", "provide", "public", "pudding", "pull", "pulp", "pulse", "pumpkin", "punch", "pupil",
  "puppy", "purchase", "purity", "purpose", "purse", "push", "put", "puzzle", "pyramid", "quality", "quantum", "quarter", "question", "quick", "quit", "quiz",
  "quote", "rabbit", "raccoon", "race", "rack", "radar", "radio", "rail", "rain", "raise", "rally", "ramp", "ranch", "random", "range", "rapid",
  "rare", "rate", "rather", "raven", "raw", "razor", "ready", "real", "reason", "rebel", "rebuild", "recall", "receive", "recipe", "record", "recycle",
  "reduce", "reflect", "reform", "refuse", "region", "regret", "regular", "reject", "relax", "release", "relief", "rely", "remain", "remember", "remind", "remove",
  "render", "renew", "rent", "reopen", "repair", "repeat", "replace", "report", "require", "rescue", "resemble", "resist", "resource", "response", "result", "retire",
  "retreat", "return", "reunion", "reveal", "review", "reward", "rhythm", "rib", "ribbon", "rice", "rich", "ride", "ridge", "rifle", "right", "rigid",
  "ring", "riot", "ripple", "risk", "ritual", "rival", "river", "road", "roast", "robot", "robust", "rocket", "romance", "roof", "rookie", "room",
  "rose", "rotate", "rough", "round", "route", "royal", "rubber", "rude", "rug", "rule", "run", "runway", "rural", "sad", "saddle", "sadness",
  "safe", "sail", "salad", "salmon", "salon", "salt", "salute", "same", "sample", "sand", "satisfy", "satoshi", "sauce", "sausage", "save", "say",
  "scale", "scan", "scare", "scatter", "scene", "scheme", "school", "science", "scissors", "scorpion", "scout", "scrap", "screen", "script", "scrub", "sea",
  "search", "season", "seat", "second", "secret", "section", "security", "seed", "seek", "segment", "select", "sell", "seminar", "senior", "sense", "sentence",
  "series", "service", "session", "settle", "setup", "seven", "shadow", "shaft", "shallow", "share", "shed", "shell", "sheriff", "shield", "shift", "shine",
  "ship", "shiver", "shock", "shoe", "shoot", "shop", "short", "shoulder", "shove", "shrimp", "shrug", "shuffle", "shy", "sibling", "sick", "side",
  "siege", "sight", "sign", "silent", "silk", "silly", "silver", "similar", "simple", "since", "sing", "siren", "sister", "situate", "six", "size",
  "skate", "sketch", "ski", "skill", "skin", "skirt", "skull", "slab", "slam", "sleep", "slender", "slice", "slide", "slight", "slim", "slogan",
  "slot", "slow", "slush", "small", "smart", "smile", "smoke", "smooth", "snack", "snake", "snap", "sniff", "snow", "soap", "soccer", "social",
  "sock", "soda", "soft", "solar", "soldier", "solid", "solution", "solve", "someone", "song", "soon", "sorry", "sort", "soul", "sound", "soup",
  "source", "south", "space", "spare", "spatial", "spawn", "speak", "special", "speed", "spell", "spend", "sphere", "spice", "spider", "spike", "spin",
  "spirit", "split", "spoil", "sponsor", "spoon", "sport", "spot", "spray", "spread", "spring", "spy", "square", "squeeze", "squirrel", "stable", "stadium",
  "staff", "stage", "stairs", "stamp", "stand", "start", "state", "stay", "steak", "steel", "stem", "step", "stereo", "stick", "still", "sting",
  "stock", "stomach", "stone", "stool", "story", "stove", "strategy", "street", "strike", "strong", "struggle", "student", "stuff", "stumble", "style", "subject",
  "submit", "subway", "success", "such", "sudden", "suffer", "sugar", "suggest", "suit", "summer", "sun", "sunny", "sunset", "super", "supply", "supreme",
  "sure", "surface", "surge", "surprise", "surround", "survey", "suspect", "sustain", "swallow", "swamp", "swap", "swarm", "swear", "sweet", "swift", "swim",
  "swing", "switch", "sword", "symbol", "symptom", "syrup", "system", "table", "tackle", "tag", "tail", "talent", "talk", "tank", "tape", "target",
  "task", "taste", "tattoo", "taxi", "teach", "team", "tell", "ten", "tenant", "tennis", "tent", "term", "test", "text", "thank", "that",
  "theme", "then", "theory", "there", "they", "thing", "this", "thought", "three", "thrive", "throw", "thumb", "thunder", "ticket", "tide", "tiger",
  "tilt", "timber", "time", "tiny", "tip", "tired", "tissue", "title", "toast", "tobacco", "today", "toddler", "toe", "together", "toilet", "token",
  "tomato", "tomorrow", "tone", "tongue", "tonight", "tool", "tooth", "top", "topic", "topple", "torch", "tornado", "tortoise", "toss", "total", "tourist",
  "toward", "tower", "town", "toy", "track", "trade", "traffic", "tragic", "train", "transfer", "trap", "trash", "travel", "tray", "treat", "tree",
  "trend", "trial", "tribe", "trick", "trigger", "trim", "trip", "trophy", "trouble", "truck", "true", "truly", "trumpet", "trust", "truth", "try",
  "tube", "tuition", "tumble", "tuna", "tunnel", "turkey", "turn", "turtle", "twelve", "twenty", "twice", "twin", "twist", "two", "type", "typical",
  "ugly", "umbrella", "unable", "unaware", "uncle", "uncover", "under", "undo", "unfair", "unfold", "unhappy", "uniform", "unique", "unit", "universe", "unknown",
  "unlock", "until", "unusual", "unveil", "update", "upgrade", "uphold", "upon", "upper", "upset", "urban", "urge", "usage", "use", "used", "useful",
  "useless", "usual", "utility", "vacant", "vacuum", "vague", "valid", "valley", "valve", "van", "vanish", "vapor", "various", "vast", "vault", "vehicle",
  "velvet", "vendor", "venture", "venue", "verb", "verify", "version", "very", "vessel", "veteran", "viable", "vibrant", "vicious", "victory", "video", "view",
  "village", "vintage", "violin", "virtual", "virus", "visa", "visit", "visual", "vital", "vivid", "vocal", "voice", "void", "volcano", "volume", "vote",
  "voyage", "wage", "wagon", "wait", "walk", "wall", "walnut", "want", "warfare", "warm", "warrior", "wash", "wasp", "waste", "water", "wave",
  "way", "wealth", "weapon", "wear", "weasel", "weather", "web", "wedding", "weekend", "weird", "welcome", "west", "wet", "whale", "what", "wheat",
  "wheel", "when", "where", "whip", "whisper", "wide", "width", "wife", "wild", "will", "win", "window", "wine", "wing", "wink", "winner",
  "winter", "wire", "wisdom", "wise", "wish", "witness", "wolf", "woman", "wonder", "wood", "wool", "word", "work", "world", "worry", "worth",
  "wrap", "wreck", "wrestle", "wrist", "write", "wrong", "yard", "year", "yellow", "you", "young", "youth", "zebra", "zero", "zone", "zoo",
]);

// ─────────── Detectors ───────────

interface Detector {
  category: FilterCategory;
  severity: 'reject' | 'hold';
  regex: RegExp;
  /**
   * Which capture group holds the value to redact + index on. 0 = whole match.
   * Defaults to 0.
   */
  group?: number;
}

// Order matters: more-specific shapes first so a single token is attributed once.
// (We dedupe by [category, index], so overlapping detectors of the SAME category
// at the SAME offset collapse to one finding.)
const SECRET_DETECTORS: Detector[] = [
  // ── Private keys (PEM blocks, raw EVM hex, Solana base58 / JSON keypair) ──
  {
    category: 'secret_private_key',
    severity: 'reject',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    // EVM private key: 0x/0X + exactly 64 hex (word-bounded so a longer hash doesn't match).
    category: 'secret_private_key',
    severity: 'reject',
    regex: /\b0[xX][0-9a-fA-F]{64}\b/g,
  },
  {
    // Bare 64-hex run (EVM private key WITHOUT the 0x prefix). A 64-hex string is also the
    // shape of a SHA-256 hash, but raw hashes almost never appear inside natural-language
    // memory CONTENT (pack hashes / merkle roots live in metadata columns, which /scan does
    // not read), so rejecting is the safe choice — a leaked private key is catastrophic.
    // Placed after the 0x rule so a prefixed key is attributed once (span-claim dedupes).
    category: 'secret_private_key',
    severity: 'reject',
    regex: /\b[0-9a-fA-F]{64}\b/g,
  },
  {
    // Bare 32-hex run (MD5-style token / Twilio auth token / unprefixed short key). This
    // also matches MD5 hashes / dashless UUIDs, but per the founder's "block secrets first"
    // rule a flagged ambiguous hex blob (the creator removes it) beats leaking a 32-hex
    // credential into a sold pack. Ordered after the 64-hex rule so a 64-hex key is never
    // split into two 32-hex findings (the 64-hex span is claimed first; no \b mid-run).
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\b[0-9a-fA-F]{32}\b/g,
  },
  {
    // Solana JSON keypair: a 64-element array of 0–255 ints (the `id.json` export shape).
    category: 'secret_private_key',
    severity: 'reject',
    regex: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/g,
  },

  // ── JWT (three base64url segments) ──
  {
    category: 'secret_jwt',
    severity: 'reject',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },

  // ── API keys / tokens (provider-prefixed) ──
  {
    // Anthropic: sk-ant-… (must precede the generic OpenAI sk- rule).
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bsk-ant-[A-Za-z0-9-]{16,}\b/g,
  },
  {
    // OpenAI: sk-… and sk-proj-… Real project keys interleave '-'/'_' in the body, so the
    // body class allows them (start+end alnum, 20+ total to avoid matching "sk-" prose).
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bsk-(?:proj-)?[A-Za-z0-9][A-Za-z0-9_-]{18,}[A-Za-z0-9]/g,
  },
  {
    // Stripe secret / restricted keys.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    // Stripe webhook signing secret.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  },
  {
    // AWS access key id.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    // AWS secret access key via the canonical env var line — capture the value.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /AWS_SECRET_ACCESS_KEY\s*[=:]\s*["']?([A-Za-z0-9/+]{32,})["']?/g,
    group: 1,
  },
  {
    // GitHub PAT / OAuth / app / refresh tokens.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    // GitHub fine-grained PAT (github_pat_…), not covered by the gh[pousr]_ shape.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    // Google OAuth client secret.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    // SendGrid API key (SG.<id>.<secret>).
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    // Slack incoming-webhook URL (the secret is in the path).
    category: 'secret_api_key',
    severity: 'reject',
    regex: /hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/g,
  },
  {
    // GitLab personal access token.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    // npm automation token.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bnpm_[A-Za-z0-9]{30,}\b/g,
  },
  {
    // HuggingFace user access token.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bhf_[A-Za-z0-9]{30,}\b/g,
  },
  {
    // Google API key.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  },
  {
    // Slack tokens (bot / app / user / refresh / config).
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    // Telegram bot token: <bot_id>:<secret>. The ':' separator splits the value into
    // two sub-40-char runs, so the entropy fallback's contiguous-run rule never sees
    // it — without this explicit shape it ships clean. Bot ids are 6–12 digits and the
    // secret is ~35 chars of [A-Za-z0-9_-]. The `digits:token` shape does not occur in
    // prose, so this is precise. Match the whole token (group 0) for redaction.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    // DigitalOcean personal access / OAuth / refresh tokens: dop_v1_ / doo_v1_ / dor_v1_
    // followed by 64 hex. Below the entropy floor in some forms and matches no other
    // prefix → previously invisible.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /\bdo[opr]_v1_[a-f0-9]{64}\b/g,
  },

  // ── Generic high-length crypto secrets (LAST, so a prefixed token always wins) ──
  {
    // Solana base58 secret key (≈88 chars, 64 bytes). Base58 excludes 0 O I l.
    // Placed after every prefixed-API-key rule so e.g. a long all-Z token attached to
    // an `sk-ant-…` key is attributed to the API-key detector, not mis-read as base58.
    category: 'secret_private_key',
    severity: 'reject',
    regex: /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/g,
  },

  // ── Passwords / credentials in connection strings or env lines ──
  {
    // scheme://user:pass@host — capture the user:pass credential pair.
    category: 'secret_password',
    severity: 'reject',
    regex: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^\s:@/]+:[^\s:@/]+)@[^\s/]+/g,
    group: 1,
  },
  {
    // password: <value> / passwd=<value> / PASSWORD=<value>. Capture the value.
    // The keyword may be glued to a non-alnum prefix (e.g. `db_passwd`), so we bound
    // on [^a-z0-9] rather than \b (which fails between '_' and 'p').
    category: 'secret_password',
    severity: 'reject',
    regex: /(?:^|[^a-z0-9])(?:password|passwd|pwd)\s*[=:]\s*["']?(\S{6,})["']?/gi,
    group: 1,
  },
  {
    // Generic credential assignment: <api_key|secret|token|auth_token|…> = <value>.
    // Captures a 16+ contiguous secret-ish value regardless of provider — converts the long
    // tail of "KEY=<random>" leaks (Twilio, Azure, custom) into a hard reject. Natural prose
    // almost never has one of these keywords immediately followed by `=`/`:` + 16+ contiguous.
    category: 'secret_api_key',
    severity: 'reject',
    regex: /(?:^|[^a-z0-9])(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|access[_-]?key)\s*[=:]\s*["']?([A-Za-z0-9_\-./+]{16,})["']?/gi,
    group: 1,
  },
];

// ── PII detectors ──
const PII_DETECTORS: Detector[] = [
  {
    category: 'pii_email',
    severity: 'hold',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    // US SSN — 3-2-4 with a dash, single space, OR dot separator (all three are in
    // everyday use). Checked BEFORE phone so 3-2-4 isn't mis-read as a phone fragment;
    // since SSN is 9 digits and the phone shape needs 10 (3-3-4) they never collide.
    // A separator is REQUIRED — a bare 9-digit run is too false-positive-prone (any
    // order/zip/id number) to flag, so `123456789` is intentionally not matched.
    category: 'pii_ssn',
    severity: 'hold',
    regex: /\b\d{3}[-. ]\d{2}[-. ]\d{4}\b/g,
  },
  {
    // US phone: optional (area) then 3-4 with space/dash separators.
    category: 'pii_phone',
    severity: 'hold',
    regex: /(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  },
];

// Candidate 16-digit runs (optionally space/dash grouped) → Luhn-checked before flagging.
const CARD_CANDIDATE = /\b(?:\d[ -]?){15}\d\b/g;

/** Standard Luhn checksum over the digits of a candidate PAN. */
function luhnValid(digits: string): boolean {
  const only = digits.replace(/\D/g, '');
  if (only.length !== 16) return false;
  let sum = 0;
  let dbl = false;
  for (let i = only.length - 1; i >= 0; i--) {
    let d = only.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// ── Shannon-entropy fallback ──
// Catches unknown high-entropy blobs (an opaque token we don't have a prefix for).
// Severity 'hold': suspicious, but not provably a credential, so it must NOT hard-reject.
//
// Two tiers, fail-closed without over-flagging prose:
//   - LONG (≥40 chars): the original catch-all at 3.8 bits/char. English prose sits
//     well below; random base64 sits above. Unchanged so its boundary tests are stable.
//   - SHORT (20–39 chars): an opaque ~24-char credential is below the 40-char floor and
//     matches no provider prefix, so it shipped clean. We catch it with a HIGHER bar
//     (4.0 bits/char): measured English words/identifiers up to ~3.6 bits, real random
//     tokens ≥4.5 bits — so 4.0 holds opaque secrets without flagging long words.
// Candidates are also split on ':' so a `digits:base64ish` segment (e.g. a token whose
// halves are each <40) is scored on its high-entropy half rather than slipping the
// contiguous-run rule.
const ENTROPY_TOKEN = /[A-Za-z0-9+/_-]{20,}/g;
const ENTROPY_MIN_BITS_LONG = 3.8; // bits/char, for runs ≥ ENTROPY_LONG_LEN.
const ENTROPY_MIN_BITS_SHORT = 4.0; // bits/char, stricter bar for shorter 20–39 runs.
const ENTROPY_LONG_LEN = 40;
const ENTROPY_SHORT_LEN = 20;

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Does a candidate run look like an opaque credential? A run qualifies if EITHER the
 * whole run, OR one of its ':'-delimited segments (e.g. the secret half of a
 * `bot_id:secret` pair), clears the tiered entropy bar for its length:
 *   - ≥40 chars  → ≥3.8 bits/char  (the original long catch-all, unchanged)
 *   - 20–39 chars → ≥4.0 bits/char (stricter, so opaque tokens hold but prose stays clean)
 * Segments shorter than 20 chars are ignored (too short to judge by entropy alone).
 */
function looksLikeOpaqueSecret(run: string): boolean {
  const parts = run.includes(':') ? [run, ...run.split(':')] : [run];
  for (const p of parts) {
    if (p.length >= ENTROPY_LONG_LEN) {
      if (shannonEntropy(p) >= ENTROPY_MIN_BITS_LONG) return true;
    } else if (p.length >= ENTROPY_SHORT_LEN) {
      if (shannonEntropy(p) >= ENTROPY_MIN_BITS_SHORT) return true;
    }
  }
  return false;
}

// ─────────── Scan ───────────

function pushFinding(
  out: Finding[],
  seen: Set<string>,
  category: FilterCategory,
  severity: 'reject' | 'hold',
  raw: string,
  index: number,
): void {
  const dedupeKey = `${category}@${index}`;
  if (seen.has(dedupeKey)) return;
  seen.add(dedupeKey);
  out.push({ category, severity, sample: redact(raw), index });
}

/**
 * Scan a single text blob for every secret + PII shape. Pure: no I/O. Returns all
 * findings with REDACTED samples; `hasSecrets` / `hasPii` derive from finding severity.
 */
export function scanText(text: string): FilterResult {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  if (typeof text !== 'string' || text.length === 0) {
    return { findings, hasSecrets: false, hasPii: false };
  }

  // Track [start,end) spans already claimed by a higher-precedence secret so a broad
  // detector (e.g. the base58 rule) can't double-flag a token a specific rule owns.
  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number): boolean =>
    claimed.some(([s, e]) => start < e && end > s);

  for (const det of SECRET_DETECTORS) {
    det.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = det.regex.exec(text)) !== null) {
      const groupIdx = det.group ?? 0;
      const value = m[groupIdx] ?? m[0];
      // Index of the captured value within the whole match.
      const valueOffsetInMatch = groupIdx === 0 ? 0 : m[0].indexOf(value);
      const start = m.index + (valueOffsetInMatch < 0 ? 0 : valueOffsetInMatch);
      const end = start + value.length;
      // Skip if a more-specific secret already claimed this span (whole-match span).
      if (overlaps(m.index, m.index + m[0].length)) {
        if (m[0].length === 0) det.regex.lastIndex++;
        continue;
      }
      claimed.push([m.index, m.index + m[0].length]);
      pushFinding(findings, seen, det.category, det.severity, value, start);
      if (m[0].length === 0) det.regex.lastIndex++; // guard against zero-width loops
    }
  }

  // PII (independent of secret spans — an email is PII even next to a token).
  for (const det of PII_DETECTORS) {
    det.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = det.regex.exec(text)) !== null) {
      pushFinding(findings, seen, det.category, det.severity, m[0], m.index);
      if (m[0].length === 0) det.regex.lastIndex++;
    }
  }

  // Credit cards: candidate run → Luhn-validate → flag. A Luhn-INVALID run is ignored.
  CARD_CANDIDATE.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CARD_CANDIDATE.exec(text)) !== null) {
    if (luhnValid(cm[0])) {
      pushFinding(findings, seen, 'pii_credit_card', 'hold', cm[0], cm.index);
    }
  }

  // Seed phrases: scan whitespace-separated lowercase tokens for a ≥12 run all in BIP39.
  detectMnemonic(text, findings, seen);

  // Entropy fallback: any high-entropy token not already claimed → hold. Tiered length
  // floors (see ENTROPY_* constants): ≥40 chars at 3.8 bits, 20–39 chars at a stricter
  // 4.0 bits so a short opaque credential is held without flagging ordinary long words.
  ENTROPY_TOKEN.lastIndex = 0;
  let em: RegExpExecArray | null;
  while ((em = ENTROPY_TOKEN.exec(text)) !== null) {
    const start = em.index;
    const end = start + em[0].length;
    if (overlaps(start, end)) continue; // already a recognised secret
    if (looksLikeOpaqueSecret(em[0])) {
      pushFinding(findings, seen, 'secret_password', 'hold', em[0], start);
    }
  }

  findings.sort((a, b) => a.index - b.index);
  const hasSecrets = findings.some((f) => f.severity === 'reject');
  const hasPii = findings.some((f) => f.severity === 'hold');
  return { findings, hasSecrets, hasPii };
}

/**
 * Detect a BIP39 mnemonic: a window of ≥12 consecutive whitespace-separated tokens,
 * every one of which is in the canonical English wordlist. Emits a single
 * `secret_seed_phrase` finding spanning the longest such run.
 */
function detectMnemonic(text: string, findings: Finding[], seen: Set<string>): void {
  const tokenRe = /[A-Za-z]+/g;
  const tokens: Array<{ word: string; index: number }> = [];
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(text)) !== null) {
    tokens.push({ word: tm[0].toLowerCase(), index: tm.index });
  }
  let runStart = -1;
  let i = 0;
  while (i < tokens.length) {
    if (BIP39_WORDS.has(tokens[i].word)) {
      if (runStart === -1) runStart = i;
    } else {
      maybeEmitRun(tokens, runStart, i, text, findings, seen);
      runStart = -1;
    }
    i++;
  }
  maybeEmitRun(tokens, runStart, tokens.length, text, findings, seen);
}

function maybeEmitRun(
  tokens: Array<{ word: string; index: number }>,
  runStart: number,
  runEndExclusive: number,
  text: string,
  findings: Finding[],
  seen: Set<string>,
): void {
  if (runStart === -1) return;
  const len = runEndExclusive - runStart;
  if (len < 12) return;
  const start = tokens[runStart].index;
  const last = tokens[runEndExclusive - 1];
  const end = last.index + last.word.length;
  pushFinding(findings, seen, 'secret_seed_phrase', 'reject', text.slice(start, end), start);
}

/**
 * Scan a pack's member records as plaintext and UNION the per-record findings.
 * Indices are per-record (offset within that record's content), which is sufficient
 * for redaction + auditing — the cross-record union is what listing safety needs.
 */
export function scanPack(records: { content: string }[]): FilterResult {
  const findings: Finding[] = [];
  let hasSecrets = false;
  let hasPii = false;
  for (const rec of records ?? []) {
    const r = scanText(rec?.content ?? '');
    findings.push(...r.findings);
    hasSecrets = hasSecrets || r.hasSecrets;
    hasPii = hasPii || r.hasPii;
  }
  return { findings, hasSecrets, hasPii };
}
