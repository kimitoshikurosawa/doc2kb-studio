# 🔭 Outils Externes, Évaluation & Monitoring des Tokens

> **Ce que Doc2KB Studio ne fait pas (volontairement), et comment le compléter.**

Doc2KB Studio est **100 % local** : aucun appel à un LLM ni à un service cloud. Ce choix garantit la confidentialité (voir le [guide 5](05-data-anonymization-and-privacy.md)), mais certaines techniques de pointe ont besoin d'un modèle. Ce guide liste les briques externes à brancher **en aval** du pack généré (`rag-chunks.jsonl`, `llms-full.txt`), ainsi que les outils pour **mesurer** la consommation de tokens au quotidien.

> ⚠️ Les outils cités évoluent vite : vérifiez leur licence, leur politique de données et leur tarification avant tout usage sur des documents sensibles. Si vous anonymisez avec Doc2KB Studio, faites-le **avant** d'envoyer quoi que ce soit à un service externe.

---

## 📑 Table des Matières
1. [Contextual Retrieval complet (LLM)](#1-contextual-retrieval-complet-llm)
2. [Late Chunking (embeddings long contexte)](#2-late-chunking-embeddings-long-contexte)
3. [Recherche hybride & Reranking](#3-recherche-hybride--reranking)
4. [Compression de prompt (avec perte)](#4-compression-de-prompt-avec-perte)
5. [Évaluer son RAG avant d'optimiser](#5-évaluer-son-rag-avant-doptimiser)
6. [Monitoring des tokens côté agents de code : RTK](#6-monitoring-des-tokens-côté-agents-de-code--rtk)
7. [Observabilité des appels LLM en production](#7-observabilité-des-appels-llm-en-production)
8. [Matrice de décision](#8-matrice-de-décision)

---

## 1. Contextual Retrieval complet (LLM)

**Ce que fait Doc2KB** : le champ `embedding_text` ajoute le fil d'Ariane des titres devant chaque chunk ([guide 2, § 3](02-rag-best-practices.md#3-linjection-de-fil-dariane-breadcrumbs-context)). C'est gratuit, déterministe et local.

**Ce que l'approche complète ajoute** : un LLM rédige pour chaque chunk 50 à 100 tokens qui le situent dans le document entier (« Ce passage concerne le chiffre d'affaires T2 2023 de la société ACME… »). Il lève ainsi les références implicites (« il », « ce contrat », « la société ») que des titres ne résolvent pas.

| Méthode (Anthropic, 2024) | Réduction des échecs de récupération (top-20) |
| :--- | :---: |
| Contextual Embeddings | −35 % |
| + Contextual BM25 | −49 % |
| + Reranking | −67 % |

**Mise en œuvre** à partir du pack Doc2KB :
1. Pour chaque ligne de `rag-chunks.jsonl`, envoyer le document complet (`docs/<fichier>.md`) + le `text` du chunk au LLM avec le prompt publié par Anthropic.
2. Remplacer le fil d'Ariane par le contexte généré : `embedding_text = contexte + "\n\n" + text`.
3. Activer le **prompt caching** sur le document : il est relu pour chacun de ses chunks. Anthropic l'estimait à ~1,02 $ par million de tokens de document.

Références : [Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) · [Cookbook Anthropic](https://github.com/anthropics/anthropic-cookbook)

---

## 2. Late Chunking (embeddings long contexte)

Au lieu d'embedder chaque chunk isolément, un modèle d'embedding long contexte encode **tout le document**, puis calcule le vecteur de chaque chunk sur ses propres tokens (*mean pooling* par segment). Chaque vecteur « voit » ainsi le document entier, sans appel LLM. Les auteurs mesurent +2,7 à +3,6 % de nDCG@10 sur BeIR.

- Compatible directement avec les chunks Doc2KB : il suffit de connaître les positions de chaque chunk dans le document (`docs/<fichier>.md`).
- Exige un modèle d'embedding long contexte qui le supporte (Jina AI l'expose par exemple via un paramètre de son API d'embeddings).

Références : [Late Chunking (arXiv 2409.04701)](https://arxiv.org/abs/2409.04701) · [Jina AI](https://jina.ai/news/late-chunking-in-long-context-embedding-models/)

---

## 3. Recherche hybride & Reranking

Indexez le champ `embedding_text` **deux fois** :

| Brique | Rôle | Exemples |
| :--- | :--- | :--- |
| Index vectoriel | Proximité sémantique | Qdrant, Weaviate, Milvus, pgvector, Chroma |
| Index lexical BM25 | Correspondances exactes (codes, références, noms) | Elasticsearch / OpenSearch, Postgres full-text, BM25 natif de Qdrant / Weaviate |
| Fusion | Combiner les deux classements | Reciprocal Rank Fusion (RRF) |
| Reranker (cross-encoder) | Reclasser finement les ~150 meilleurs candidats | Cohere Rerank, Voyage rerank, `bge-reranker` (open source, auto-hébergeable) |

Ensuite, injectez dans le prompt le champ `text` (et non `embedding_text`) des chunks retenus.

---

## 4. Compression de prompt (avec perte)

Doc2KB Studio fait une réduction **quasi sans perte** : suppression du bruit (boilerplate, images base64, espaces de tableaux, paramètres de tracking). Pour aller plus loin, des outils comme **LLMLingua / LongLLMLingua** (Microsoft Research) suppriment les tokens jugés peu informatifs par un petit modèle de langue. Ils annoncent jusqu'à 20x de compression avec une faible perte sur leurs benchmarks.

**À réserver** au contexte éphémère d'une requête (chunks récupérés, historique de conversation). **Jamais** pour la base de connaissances elle-même : le texte compressé n'est plus lisible par un humain, et l'information supprimée l'est définitivement.

Références : [LLMLingua](https://github.com/microsoft/LLMLingua) · [LongLLMLingua (arXiv 2310.06839)](https://arxiv.org/abs/2310.06839)

---

## 5. Évaluer son RAG avant d'optimiser

Les réglages par défaut (600 / 150 / 15 %) sont des **points de départ** issus de benchmarks publics. Le bon réglage dépend de **vos** documents et de **vos** questions. La configuration du chunking pèse autant que le choix du modèle d'embedding (Vectara, NAACL 2025).

1. Constituez 30 à 100 questions réelles avec la réponse attendue et la source.
2. Mesurez le **recall@k** (le bon chunk est-il dans les k premiers ?) puis la qualité de la réponse finale.
3. Faites varier un seul paramètre à la fois : `chunkMaxTokens` (256 / 512 / 1 024), `chunkMinTokens`, `chunkOverlapTokens`, `tableFormat`.

Outils : [Ragas](https://github.com/explodinggradients/ragas) (métriques RAG : fidélité, pertinence, rappel du contexte), ou un simple script de recall@k sur `rag-chunks.jsonl`.

---

## 6. Monitoring des tokens côté agents de code : RTK

Si votre équipe développe avec des **agents de code** (Claude Code, Cursor, Copilot, Gemini CLI), une bonne part des tokens consommés vient de la **sortie des commandes shell** (`git log`, `npm test`, `docker ps`…), pas des documents. **[RTK (Rust Token Killer)](https://www.rtk-ai.app/docs/)** est un proxy CLI qui filtre cette sortie avant qu'elle n'atteigne le LLM : suppression du bruit, regroupement, troncature, dédoublonnage des lignes répétées. Il annonce 60 à 90 % de sortie en moins selon les commandes.

```bash
# Installation (au choix)
brew install rtk
cargo install --git https://github.com/rtk-ai/rtk
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# Hook Claude Code : réécrit automatiquement les commandes bash vers leur équivalent RTK
rtk init -g          # puis redémarrer Claude Code

# Monitoring
rtk gain             # économies cumulées
rtk gain --daily     # détail par jour (--weekly par semaine)
rtk discover         # commandes exécutées SANS filtrage RTK (opportunités manquées)
rtk session          # taux d'adoption de RTK par session Claude Code
```

**Bien interpréter les chiffres** : RTK réduit les octets de **sortie shell**. Votre facture comprend aussi le prompt système, l'historique et les tokens générés, donc l'économie réelle sur la facture est plus faible que le pourcentage affiché par `rtk gain`.

**Complémentarité avec Doc2KB Studio** :

| Source de tokens | Outil |
| :--- | :--- |
| Documents de la base de connaissances (Word, PDF, Excel, HTML…) | **Doc2KB Studio** : conversion, compaction, chunking |
| Sortie des commandes lancées par les agents de code | **RTK** |
| Appels LLM de votre application en production | Observabilité (§ 7) |

Références : [Documentation RTK](https://www.rtk-ai.app/docs/) · [Dépôt GitHub rtk-ai/rtk](https://github.com/rtk-ai/rtk) (licence Apache 2.0 indiquée sur le dépôt)

---

## 7. Observabilité des appels LLM en production

Pour suivre tokens, coûts et latence des requêtes réelles de votre application RAG :

- **Champ `usage` des réponses API** : chaque appel renvoie les tokens d'entrée, de sortie et, quand le prompt caching est actif, les tokens lus ou écrits en cache. C'est la source de vérité de la facture : journalisez-la.
- **Comptage avant envoi** : les fournisseurs exposent une API de comptage (par exemple `count_tokens` chez Anthropic). Les compteurs de Doc2KB (`o200k_base`, `cl100k_base`) sont une **estimation** : chaque modèle a son propre tokenizer.
- **Plateformes de traces** (ex. Langfuse, open source et auto-hébergeable, ou les intégrations OpenTelemetry) : traces par requête, coût par utilisateur ou fonctionnalité, évaluations en continu.

Indicateurs à suivre : tokens d'entrée par requête (signal de *context rot* quand ils grossissent), taux de lecture en cache, nombre de chunks injectés, recall@k sur votre jeu d'évaluation.

---

## 8. Matrice de décision

| Situation | Recommandation |
| :--- | :--- |
| Corpus < 200k tokens (`contextStrategy: full_context`) | Pas de RAG : `llms-full.txt` en entier + prompt caching |
| Corpus > 200k tokens, budget serré, données sensibles | `embedding_text` Doc2KB + hybride BM25 + reranker auto-hébergé |
| Corpus > 200k tokens, précision maximale | + Contextual Retrieval complet (§ 1) sur données anonymisées |
| Documents longs avec beaucoup de renvois internes | Late chunking (§ 2) |
| Contexte de requête trop long (historique, nombreux chunks) | Compression de prompt (§ 4) |
| Facture tirée par des agents de code | RTK (§ 6) |
