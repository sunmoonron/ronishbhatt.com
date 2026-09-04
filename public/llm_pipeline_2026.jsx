const { useState } = React;

const PIPELINE = [
  {
    id: "data",
    label: "Data Curation",
    emoji: "🗄️",
    color: "#1a3a2a",
    accent: "#4ade80",
    position: 0,
    summary: "Filtering, dedup, mixing of web-scale corpora",
    frontier: [
      { title: "UberWeb (DatologyAI, Feb 2026)", note: "Targeted per-language curation of 20T-token corpus; 3B/8B models match baselines at 4–10× lower compute." },
      { title: "Data Mixing Laws (ICLR 2025)", note: "Discovered predictable functional relationships between mixture proportions and downstream model performance." },
      { title: "DCLM / DataComp-LM", note: "Established quality-classifier-filtered web corpus; remains primary 7B baseline for ablations." },
      { title: "Nemotron-CC + Nemotron-Synth (NVIDIA)", note: "2T tokens synthetically rephrased from Common Crawl; 4× unique tokens vs DCLM; +5.6 MMLU at 1T training." },
      { title: "BeyondWeb (Arcee, Aug 2025)", note: "New Pareto frontier for accuracy-efficiency; outperforms Nemotron-Synth by +2.6pp at 8B scale, 2.7× faster." },
      { title: "SoftDedup (2024)", note: "Reweights duplicates instead of removing, preserving information while reducing redundancy; −26% training steps for same perplexity." },
      { title: "FineWeb-Edu / Stack-Edu", note: "LLM-scored educational quality filtering; extended to multilingual (TransWeb-Edu, Chinese via Qwen)." },
    ],
    open: false,
  },
  {
    id: "tokenization",
    label: "Tokenization",
    emoji: "✂️",
    color: "#1a2a3a",
    accent: "#60a5fa",
    position: 1,
    summary: "Subword, byte-level, and patch-based approaches",
    frontier: [
      { title: "BLT – Byte Latent Transformer (Meta, ACL 2025)", note: "Tokenization-free dynamic patching; matches BPE LLMs at 8B/4T tokens scale, up to 50% inference FLOP savings at high compression." },
      { title: "SuperBPE (COLM 2025)", note: "Cross-word BPE merges; 33% fewer tokens, +4.0% avg across 30 benchmarks, +8.2% MMLU." },
      { title: "BoundlessBPE (COLM 2025)", note: "Removes pre-tokenization boundary constraint; up to 15% bytes-per-token improvement." },
      { title: "Bolmo / Byteifying (Dec 2025)", note: "Converts subword LLMs to byte-level at training time; advances efficiency Pareto over BPE at large vocab sizes." },
      { title: "LiteToken (Feb 2026)", note: "Removes 'residue tokens' (≈10% of vocab) from BPE tokenizers; plug-and-play, reduces fragmentation." },
    ],
    open: false,
  },
  {
    id: "architecture",
    label: "Architecture",
    emoji: "🏗️",
    color: "#2a1a3a",
    accent: "#a78bfa",
    position: 2,
    summary: "Transformer variants, MoE, SSM hybrids, attention",
    frontier: [
      { title: "FlashAttention 3 (2025)", note: "IO-aware attention kernel; near-universal adoption in frontier training. Underlying kernel for most 2025–2026 LLMs." },
      { title: "MoE at Scale (DeepSeek-V3, Qwen3-MoE, Mixtral)", note: "Sparse mixture-of-experts now standard at frontier; 2+1 active experts out of 32–64 total; 10× parameter efficiency." },
      { title: "Jamba / Mamba-2 Hybrids (AI21, NVIDIA Bamba-9B)", note: "Interleaved Attention + Mamba2 layers; 2× throughput, 7× less data vs LLaMA-3.1-8B (Bamba); Hunyuan-TurboS: 560B total, 56B active, 128 layers." },
      { title: "GQA / MQA (universal adoption)", note: "Grouped-query attention now default in all frontier models, dramatically reducing KV cache footprint." },
      { title: "LongRoPE2 (ICLR 2025)", note: "Near-lossless context extension to 128K+ via evolutionary RoPE search + mixed training; >98.5% short-context accuracy retained." },
      { title: "Mamba-3 (2026)", note: "Complex-valued states, exponential-trapezoidal update; designed for deployment efficiency over training speed." },
    ],
    open: false,
  },
  {
    id: "pretraining",
    label: "Pre-Training",
    emoji: "⚡",
    color: "#3a1a1a",
    accent: "#f87171",
    position: 3,
    summary: "Compute-optimal training, distributed systems, scaling laws",
    frontier: [
      { title: "Farseer Scaling Laws (Jun 2025)", note: "Replaces Chinchilla; 4× lower extrapolation error; predicts tokens-per-parameter ratio grows with scale (key for frontier decisions)." },
      { title: "Test-Time-Aware Scaling (Apr 2026)", note: "Chinchilla-style law revised to account for inference cost; models used for heavy reasoning should be trained smaller and longer." },
      { title: "4D Parallelism at 16K GPUs (Llama-3, ISCA 2025)", note: "Data + tensor + pipeline + sequence parallelism; LLaMA-3 trained across 16,384 H100s over 54 days." },
      { title: "Qwen3-0.6B (Apr 2025)", note: "Record 60,000:1 tokens-to-params ratio on 36T tokens; new empirical upper bound for overtraining." },
      { title: "Liquid LFM2.5-350M (Apr 2026)", note: "New record: 80,000:1 ratio, 28T tokens on 350M params with large-scale RL; breaks Qwen3 record." },
      { title: "Synthetic data at scale", note: "Meta (Oct 2025): rephrased synthetic + real data shows no model collapse at foreseeable scales; textbook-style pure synthetic shows collapse patterns." },
    ],
    open: false,
  },
  {
    id: "midtraining",
    label: "Mid-Training",
    emoji: "🔄",
    color: "#3a2a1a",
    accent: "#fb923c",
    position: 4,
    summary: "Long-context, domain adaptation, continued pre-training",
    frontier: [
      { title: "Mid-Training as distinct stage (2025 consensus)", note: "Now recognized as a formal pipeline stage between pre-training and post-training; domain-specific data, long-context data, and reasoning priming." },
      { title: "Hierarchical synthetic long-context (2025)", note: "RoPE scaling + step-by-step context extension to 1M tokens with RULER benchmark validation; synthetic data generation overcomes real long-doc scarcity." },
      { title: "Pre/Mid/RL interplay study (Dec 2025)", note: "First controlled study showing mid-training expands 'primitive coverage' — sets prior for what RL can later unlock." },
      { title: "LLaMA-3 context extension pipeline", note: "6 stages, 8K → 128K, 800B tokens; establishes gold standard recipe for staged long-context adaptation." },
      { title: "Training-free extrapolation", note: "Training-free RoPE frequency manipulation (DIEM, Apr 2025) enables 8K→128K context with zero fine-tuning cost." },
    ],
    open: false,
  },
  {
    id: "sft",
    label: "Supervised Fine-Tuning",
    emoji: "🎓",
    color: "#1a3a3a",
    accent: "#2dd4bf",
    position: 5,
    summary: "Instruction tuning, data quality, long-CoT distillation",
    frontier: [
      { title: "GRAPE – Distribution-aligned SFT (NeurIPS 2025 spotlight)", note: "SFT most effective when data aligns with model's pretrained distribution; out-of-distribution responses cause diminishing returns at scale." },
      { title: "Data Repetition > Data Scaling for long-CoT SFT (Feb 2026, Mistral/NVIDIA)", note: "Training many epochs on a small CoT subset outperforms training one epoch on millions of samples; reverses standard scaling intuition." },
      { title: "Iterative Rejection-Sampling SFT", note: "Reward-model-filtered iterative data curation; label replacement via ILR (Ye et al., Jan 2025) robust to noisy supervision." },
      { title: "Prefix-RFT (OpenReview 2026)", note: "Blends SFT demonstrations with RL rollouts via prefix sampling; unified paradigm outperforms either alone." },
      { title: "Modern scale: 1–10M examples", note: "Nemotron-3 Super: 7M final SFT samples selected from 40M-sample corpus; quality >> quantity confirmed across labs." },
    ],
    open: false,
  },
  {
    id: "reward",
    label: "Reward Modeling",
    emoji: "🏆",
    color: "#2a3a1a",
    accent: "#a3e635",
    position: 6,
    summary: "ORM, PRM, verifier models, step-level supervision",
    frontier: [
      { title: "Process Reward Models (PRM) mainstream (2025)", note: "Now applied beyond math/code: dialogue, RAG, web agents (Web-Shepherd), clinical notes, multimodal reasoning." },
      { title: "FreePRM (Jun 2025)", note: "Achieves 53.0% avg F1 on ProcessBench using only outcome labels — surpasses fully supervised PRMs by 24pp; no step labels needed." },
      { title: "Q-RM – Token-level Q-values (May 2025)", note: "Decouples reward from generation probability via Q-functions; eliminates reward-probability conflicts, faster RL convergence." },
      { title: "CAPO / GenPRM (Apr 2025)", note: "Generative PRMs that assign grouped step-level rewards; scale test-time compute of the verifier itself." },
      { title: "PURE (2025)", note: "Min-form PRM objective addresses reward hacking from summing step rewards; more robust RL training signal." },
      { title: "Scalable automated process verifiers (ICLR 2025)", note: "Monte Carlo step verification scales PRM data generation without human annotation; approaches human-labeled quality." },
    ],
    open: false,
  },
  {
    id: "alignment",
    label: "Alignment / RLHF",
    emoji: "🧭",
    color: "#3a1a2a",
    accent: "#f472b6",
    position: 7,
    summary: "RLHF, DPO, GRPO, DAPO, RLVR — the new post-training stack",
    frontier: [
      { title: "RLVR paradigm (DeepSeek-R1, Jan 2025)", note: "RL with verifiable rewards (math, code) replaces human labels at scale; no reward model required for verifiable domains; now dominant for reasoning." },
      { title: "GRPO (DeepSeek) → dominant critic-free algorithm", note: "Eliminates separate value model; samples group of responses per prompt, computes relative advantages. Now used in Nemotron-3 Super, Qwen3, and others." },
      { title: "DAPO (early 2025)", note: "Fixes GRPO instability: clip-shifting, dynamic sampling, token-level loss, drops KL penalty entirely; achieved 50% on AIME 2024." },
      { title: "TTRL (label-free RL)", note: "Majority voting as proxy reward; >200% improvement on AIME 2024 without ground-truth labels." },
      { title: "ΨPO unification (2026)", note: "Proves DPO, IPO, KTO, SimPO are mathematically identical up to loss function choice; unified analytical framework." },
      { title: "1-shot RLVR (2025)", note: "Single training example improves MATH500 from 36.0% to 73.6%; fundamentally challenges data requirements." },
      { title: "RLAIF / Constitutional AI evolution", note: "Multi-turn safety alignment (MTSA, 2025); automated red-teaming via LLM-generated constitutions; jailbreak robustness via future-reward multi-turn RL." },
    ],
    open: false,
  },
  {
    id: "testtimecompute",
    label: "Test-Time Compute",
    emoji: "🧠",
    color: "#1a2a1a",
    accent: "#86efac",
    position: 8,
    summary: "Chain-of-thought, Best-of-N, MCTS, latent reasoning",
    frontier: [
      { title: "OpenAI o3 / DeepSeek-R1-era (2025)", note: "Inference-time scaling via extended chain-of-thought now production standard; DeepSeek-R1 matches o1 at 70% lower cost." },
      { title: "Test-time compute makes overtraining optimal (Apr 2026)", note: "First formal theory: models used for intensive inference should be trained smaller/longer than Chinchilla-optimal; training and inference compute are coupled." },
      { title: "Don't Overthink It (May 2025)", note: "Longer thinking does NOT monotonically improve accuracy; 'deep-thinking ratio' (r=0.828) outperforms token count (r=−0.544) as predictor." },
      { title: "Latent recurrent reasoning (Feb 2025)", note: "Recurrent depth models compute in latent space; no specialized CoT data required; emerges rotation-in-latent-space for numerics." },
      { title: "Diverse inference approach (2025)", note: "Combining multiple models + methods at test time: Lean verification for IMO, rejection sampling for HLE; 33% → 77.8% on IMO combinatorics." },
      { title: "M1 – Mamba reasoning model (Apr 2025)", note: "3× inference speedup vs Transformer at same accuracy (MATH500: 82, AIME25: 22); speedup → more Best-of-N samples → better accuracy." },
    ],
    open: false,
  },
  {
    id: "rag",
    label: "RAG / Retrieval",
    emoji: "🔍",
    color: "#2a1a3a",
    accent: "#c084fc",
    position: 9,
    summary: "Modular, agentic, graph-based retrieval augmentation",
    frontier: [
      { title: "Agentic RAG (dominant 2025–2026 pattern)", note: "Specialized agents handle query planning, retrieval, reranking, validation in parallel; iterative self-correction; Self-RAG / CRAG standard." },
      { title: "GraphRAG / LightRAG (Microsoft, 2024–2025)", note: "Knowledge-graph augmented retrieval; community-summarized global context + local entity retrieval; strong gains on multi-hop QA (+4–10% F1)." },
      { title: "HippoRAG2 (2025)", note: "Neuroscience-inspired hierarchical memory; outperforms standard vector RAG on knowledge-intensive multi-hop tasks." },
      { title: "A-RAG (Feb 2026)", note: "Hierarchical retrieval interfaces with autonomous strategy + iterative execution + interleaved tool use; first system satisfying all three agentic autonomy principles." },
      { title: "DF-RAG / Disco-RAG (Jan 2026)", note: "Diversity-aware MMR selection + discourse-tree-guided generation; coherence and multi-hop improvements on long/semi-structured inputs." },
    ],
    open: false,
  },
  {
    id: "inference",
    label: "Inference & Serving",
    emoji: "🚀",
    color: "#1a1a3a",
    accent: "#818cf8",
    position: 10,
    summary: "Quantization, speculative decoding, KV cache, batching",
    frontier: [
      { title: "Speculative decoding (production standard 2025–2026)", note: "Draft-then-verify now in vLLM, SGLang, TensorRT-LLM; 2–3× latency reduction; QuantSpec combines with KV cache quantization for 1.78× at 128K context." },
      { title: "Continuous batching + PagedAttention", note: "10–20× throughput vs static batching; universal in serving frameworks; UELLM (2025): 72–90% latency reduction via smarter batching + resource profiling." },
      { title: "INT4 / INT8 / fp8 quantization standard", note: "GPTQ, AWQ, fp8 for weights; KV cache quantization for long context; 4–8× memory reduction with minimal quality loss now routine." },
      { title: "Hybrid SSM serving (vLLM, 2026)", note: "vLLM adds native Mamba-layer support for hybrid models (NVIDIA Nemotron-H); linear-time decode for Mamba layers, full attention for attention layers." },
      { title: "Prefix caching + shared KV reuse", note: "Cached shared prefixes dramatically cut per-request cost in production; + speculative decoding acceptance rate improves with caching." },
      { title: "Inference > training by 118× (projection)", note: "By 2026, inference demand projected to exceed training compute by 118×; driving $7T infrastructure investment to 2030." },
    ],
    open: false,
  },
  {
    id: "agents",
    label: "Agents & Tool Use",
    emoji: "🤖",
    color: "#2a2a1a",
    accent: "#fbbf24",
    position: 11,
    summary: "Agentic frameworks, multi-agent orchestration, MCP",
    frontier: [
      { title: "MCP (Model Context Protocol) universally adopted (2025)", note: "Standard protocol for tool/server integration; adopted by Anthropic, OpenAI, Google, Microsoft; eliminated fragmentation in agent integration." },
      { title: "Context engineering > prompt engineering", note: "Agent failures are primarily context failures; Manus's architecture rewrites, four-operations memory taxonomy (save/update/retrieve/delete) now standard." },
      { title: "OpenAI Agents SDK / Anthropic Claude Code (2025)", note: "Production-ready agentic frameworks with built-in tool execution, multi-agent handoffs as first-class primitives." },
      { title: "SWE-bench Verified frontier: 80.9% (Claude Opus 4.5, Mar 2026)", note: "Real GitHub issue resolution jumped from ~65% (early 2025) to 80.9%; agentic coding now near-human on many tasks." },
      { title: "Multi-agent orchestration at scale", note: "2.4B API calls/week through multi-agent frameworks (Q1 2026); 'more agents ≠ better' — coordination pattern must match workload (Google/MIT)." },
      { title: "RLVR for agents", note: "RL with verifiable tool-use rewards extends beyond math/code to web navigation (WebArena, τ-bench), GUI agents, robotics." },
    ],
    open: false,
  },
  {
    id: "evaluation",
    label: "Evaluation",
    emoji: "📊",
    color: "#1a3a1a",
    accent: "#34d399",
    position: 12,
    summary: "Frontier benchmarks, saturation, and new hard evals",
    frontier: [
      { title: "MMLU / GSM8K / HellaSwag — saturated", note: "MMLU: 88–94% for frontier models; GSM8K: effectively solved. No longer differentiates frontier models as of 2025." },
      { title: "GPQA Diamond (graduate-level science)", note: "94.3% for frontier models as of early 2026; approaching saturation. Was the hardest public science benchmark in 2024." },
      { title: "Humanity's Last Exam (HLE, Nature Jan 2026)", note: "2,500 questions across 100+ subjects from 1,000+ experts; humans ≈90% in their field. Frontier: Grok 4 leads at 50.7%, Claude Opus 4.6 at 34.4%, GPT-5 Pro at 31.6%." },
      { title: "ARC-AGI-2 (abstract reasoning)", note: "Gemini 3.1 Pro leads; tests fluid reasoning not solvable by pattern matching from training data." },
      { title: "SWE-bench Verified (real code)", note: "80.9% Claude Opus 4.5 (Mar 2026); contamination now actively audited by OpenAI and others." },
      { title: "AIME 2025/2026 (math frontier)", note: "Qwen3.5-plus: 91.3% AIME 2026; GPT-5.3 Codex: 94% AIME 2025. New annual releases prevent saturation." },
      { title: "Arena Elo (human preference)", note: "Claude Opus 4.6 leads code Arena (1548); most reliable production-intent signal; contamination-resistant by design." },
    ],
    open: false,
  },
];

const ARROW = "→";

function LLMPipeline() {
  const [nodes, setNodes] = useState(PIPELINE);
  const [hovered, setHovered] = useState(null);

  const toggle = (id) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, open: !n.open } : n))
    );
  };

  const allClosed = nodes.every((n) => !n.open);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#e8e8f0",
        fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
        padding: "32px 24px",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div style={{ maxWidth: 900, margin: "0 auto 40px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            marginBottom: 8,
          }}
        >
          <h1
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "clamp(20px, 3vw, 32px)",
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.02em",
              color: "#f0f0ff",
            }}
          >
            Modern LLM Pipeline
          </h1>
          <span
            style={{
              fontSize: 12,
              background: "#1e1e2e",
              border: "1px solid #333",
              borderRadius: 4,
              padding: "2px 8px",
              color: "#888",
              letterSpacing: "0.05em",
            }}
          >
            as of May 2026
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "#666",
            lineHeight: 1.6,
          }}
        >
          Click any stage to reveal the frontier papers &amp; advances pushing it forward.
        </p>
      </div>

      {/* Pipeline flow */}
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {nodes.map((node, i) => (
          <div key={node.id}>
            {/* Stage Card */}
            <div
              onClick={() => toggle(node.id)}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: hovered === node.id || node.open
                  ? `linear-gradient(135deg, ${node.color}dd, #0f0f1a)`
                  : "#0f0f1a",
                border: `1px solid ${node.open ? node.accent + "88" : "#222"}`,
                borderRadius: 8,
                padding: "14px 20px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 14,
                transition: "all 0.18s ease",
                boxShadow: node.open
                  ? `0 0 0 1px ${node.accent}44, 0 4px 24px ${node.accent}22`
                  : "none",
                userSelect: "none",
              }}
            >
              {/* Number badge */}
              <span
                style={{
                  fontSize: 10,
                  color: node.open ? node.accent : "#444",
                  fontWeight: 700,
                  minWidth: 24,
                  letterSpacing: "0.08em",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              {/* Emoji */}
              <span style={{ fontSize: 20 }}>{node.emoji}</span>
              {/* Label */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: node.open ? node.accent : "#ccc",
                    letterSpacing: "-0.01em",
                    transition: "color 0.18s",
                  }}
                >
                  {node.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#555",
                    marginTop: 1,
                    letterSpacing: "0.01em",
                  }}
                >
                  {node.summary}
                </div>
              </div>
              {/* Toggle arrow */}
              <span
                style={{
                  fontSize: 12,
                  color: node.open ? node.accent : "#333",
                  transform: node.open ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.18s, color 0.18s",
                }}
              >
                ▶
              </span>
            </div>

            {/* Expanded content */}
            {node.open && (
              <div
                style={{
                  background: "#0c0c18",
                  border: `1px solid ${node.accent}44`,
                  borderTop: "none",
                  borderRadius: "0 0 8px 8px",
                  padding: "16px 20px 20px 58px",
                  marginBottom: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: node.accent,
                    letterSpacing: "0.12em",
                    fontWeight: 700,
                    marginBottom: 12,
                    textTransform: "uppercase",
                  }}
                >
                  Frontier Advances
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {node.frontier.map((item, fi) => (
                    <div
                      key={fi}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                      }}
                    >
                      <span
                        style={{
                          color: node.accent,
                          fontSize: 10,
                          marginTop: 3,
                          minWidth: 8,
                        }}
                      >
                        ◆
                      </span>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#ddd",
                            marginBottom: 2,
                          }}
                        >
                          {item.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#888",
                            lineHeight: 1.55,
                          }}
                        >
                          {item.note}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connector */}
            {i < nodes.length - 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "4px 0",
                  color: "#2a2a3a",
                  fontSize: 18,
                  lineHeight: 1,
                  userSelect: "none",
                }}
              >
                │
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          maxWidth: 900,
          margin: "40px auto 0",
          paddingTop: 20,
          borderTop: "1px solid #1a1a2a",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 11, color: "#444" }}>
          Sources: arXiv, OpenReview, NeurIPS/ICLR/ACL 2025, llm-stats.com, emergentmind.com — verified May 2026
        </span>
        <button
          onClick={() =>
            setNodes((prev) =>
              prev.map((n) => ({ ...n, open: !allClosed }))
            )
          }
          style={{
            background: "none",
            border: "1px solid #333",
            borderRadius: 4,
            color: "#666",
            fontSize: 11,
            padding: "4px 12px",
            cursor: "pointer",
            fontFamily: "inherit",
            letterSpacing: "0.05em",
          }}
        >
          {allClosed ? "expand all" : "collapse all"}
        </button>
      </div>
    </div>
  );
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<LLMPipeline />);
