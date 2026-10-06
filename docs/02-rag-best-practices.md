# 🧩 Guide des Meilleures Pratiques RAG & Découpage Sémantique

> **Architecture de données non structurées, chunking structure-aware, contextual retrieval et indexation vectorielle.**

---

## 📑 Table des Matières
1. [L'Échec du Chunking Naïf : Pourquoi les RAG échouent](#1-léchec-du-chunking-naïf--pourquoi-les-rag-échouent)
2. [Découpage Sémantique Arborescent (*Structure-Aware Chunking*)](#2-découpage-sémantique-arborescent-structure-aware-chunking)
3. [L'Injection de Fil d'Ariane (*Breadcrumbs Context*)](#3-linjection-de-fil-dariane-breadcrumbs-context)
4. [Traitement Atomique des Tableaux et Blocs de Code](#4-traitement-atomique-des-tableaux-et-blocs-de-code)
5. [Dimensionnement & Stratégie d'Overlap](#5-dimensionnement--stratégie-doverlap)
6. [Format JSONL & Intégration Vectorielle (Pinecone, Chroma, Qdrant)](#6-format-jsonl--intégration-vectorielle-pinecone-chroma-qdrant)
7. [Architecture en 2 Étapes : Bi-Encoder + Cross-Encoder Reranker](#7-architecture-en-2-étapes--bi-encoder--cross-encoder-reranker)

---

## 1. L'Échec du Chunking Naïf : Pourquoi les RAG échouent

La majorité des implémentations de RAG (Retrieval-Augmented Generation) souffrent du syndrome **"Garbage In, Garbage Out"**.

Le problème prend sa source dans le découpage mécanique aveugle :
```
[Texte source découpé arbitrairement tous les 500 caractères]
Chunk 1: "...les critères d'admissibilité sont définis à la section 4. Concernant les délais de"
Chunk 2: "paiement, ils ne pourront en aucun cas excéder quarante-cinq (45) jours fin de mois..."
```

### Les 3 Conséquences Désastreuses :
1. **Perte de Sujet (*Subject Loss*)** : Le Chunk 2 mentionne "ils ne pourront en aucun cas excéder", mais le mot "délais de paiement" est resté dans le Chunk 1. Le modèle d'embedding ne sait pas à quoi "ils" fait référence.
2. **Éclatement des Tableaux (*Orphan Cells*)** : Un tableau coupé à la ligne 4 perd sa ligne d'en-tête. La cellule contenant `12 500 €` n'a plus de colonne "Chiffre d'affaires" pour lui donner du sens.
3. **Pollution du Contexte** : Pour compenser ces coupures, les développeurs augmentent le nombre de documents retournés (`top_k = 10`), ce qui sature la fenêtre de contexte et fait grimper les coûts d'inférence en flèche.

---

## 2. Découpage Sémantique Arborescent (*Structure-Aware Chunking*)

Doc2KB Studio adopte le principe de **l'unité sémantique atomique**. Un document n'est pas une chaîne de caractères continue : c'est un **arbre hiérarchique**.

```
Document
├── # Titre Principal (H1)
│   ├── ## Section A (H2)
│   │   ├── Paragraphe explicatif
│   │   └── ### Sous-section A.1 (H3)
│   └── ## Section B (Tableau de Données) (H2)
```

### L'Algorithme de Découpage de `lib/semanticChunker.js` :
1. **Préservation des délimiteurs ATX** : Chaque en-tête (`#`, `##`, `###`) initie une frontière de section naturelle.
2. **Plancher de taille (`chunkMinTokens`, défaut 150)** : les sections voisines trop courtes sont fusionnées jusqu'à atteindre le plancher, sans jamais dépasser `chunkMaxTokens`. Les titres internes (`## Contact`, `## Horaires`…) restent dans le texte et le chunk fusionné est rangé sous leur parent commun. Un dernier fragment trop court est rattaché au chunk précédent. `chunkMinTokens: 0` redonne un chunk par titre.
3. **Sous-partitionnement contrôlé** : si une section dépasse le plafond (`chunkMaxTokens`, défaut 600), elle est scindée aux frontières de paragraphes (`\n\n`), puis de lignes, puis de phrases. La découpe brute par tokens n'intervient qu'en dernier recours.

> **Pourquoi un plancher ?** Au benchmark FloTorch 2026 (50 articles, 905k tokens), le découpage « sémantique » obtient le meilleur rappel (91,9 %) mais seulement 54 % de précision finale, contre 69 % pour un découpage récursif à 512 tokens : ses fragments faisaient **43 tokens en moyenne**, trop peu de contexte pour le LLM. Recommandation issue du benchmark : un plancher de 200-400 tokens en découpage sémantique. Doc2KB Studio, qui découpe d'abord par titres, retient 150 par défaut.
>
> Sur `docs/02-rag-best-practices.md` lui-même : 13 chunks (minimum 39 tokens, médiane 166) sans plancher, contre 8 chunks (minimum 166, médiane 295) avec les réglages par défaut.

---

## 3. L'Injection de Fil d'Ariane (*Breadcrumbs Context*)

Anthropic a mesuré ([Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)) qu'ajouter devant chaque chunk 50 à 100 tokens de contexte rédigés par un LLM, avant l'embedding et l'indexation BM25, réduit les échecs de récupération de **35 %** (embeddings seuls), **49 %** (avec BM25) et **67 %** (avec reranking en plus).

Doc2KB Studio en applique la version **100 % locale et gratuite** : le fil d'Ariane des titres. Chaque chunk du JSONL contient deux textes :

| Champ | Contenu | Usage |
| :--- | :--- | :--- |
| `embedding_text` | `fil d'Ariane` + ligne vide + `text` | **À embedder et à indexer en BM25** |
| `text` | Contenu brut du chunk | **À injecter dans le prompt** (pas de doublon de contexte) |

```json
{
  "id": "manuel_tech_chunk_4",
  "doc_title": "Manuel d'Exploitation Cloud",
  "breadcrumbs": "Manuel d'Exploitation Cloud > Haute Disponibilité > Procédure de Failover",
  "token_count": 215,
  "text": "### Procédure de Failover\n\nEn cas de perte du nœud maître, la bascule s'effectue automatiquement sous 15 secondes...",
  "embedding_text": "Manuel d'Exploitation Cloud > Haute Disponibilité > Procédure de Failover\n\n### Procédure de Failover\n\nEn cas de perte..."
}
```

Le fil d'Ariane ne remplace pas un contexte rédigé par un LLM (il ne résout pas « il », « ce contrat »…). Pour aller plus loin, voir le [guide 6](06-external-tools-and-monitoring.md#1-contextual-retrieval-complet-llm).

Lorsque l'utilisateur pose la question : *« Combien de temps prend la bascule du nœud maître ? »*, le modèle d'embedding fait le lien non seulement avec le mot "bascule", mais aussi avec les concepts "Manuel d'Exploitation", "Haute Disponibilité" et "Failover".

---

## 4. Traitement Atomique des Tableaux et Blocs de Code

Les données tabulaires et le code représentent l'information la plus dense et la plus fragile d'un document.

### Règles d'Or Implémentées :
1. **Les En-têtes Restent Soudés** :
   Quand un tableau dépasse `chunkMaxTokens`, il est découpé par lignes et **la ligne d'en-tête + la ligne `|---|` sont répétées dans chaque chunk**. Sans cela, les lignes du 2ᵉ chunk ne sont plus que des cellules anonymes, inexploitables pour le moteur de recherche comme pour le LLM.
2. **Compactage des Séparateurs** :
   Les séparateurs de colonnes verbeux (`|:------------------|`) sont compressés en `|---|`.
3. **Mode Records pour la Recherche Sémantique** :
   Lorsqu'un tableau comporte plus de 8 colonnes, Doc2KB Studio peut le projeter sous forme de liste de fiches descriptives :
   ```markdown
   - [Fiche Serveur 1] IP: 10.0.0.1 | Rôle: Gateway | État: Actif
   - [Fiche Serveur 2] IP: 10.0.0.2 | Rôle: Database | État: Standby
   ```
   Ce format permet au modèle d'embedding de capter chaque attribut avec un score de similarité bien supérieur à un tableau ASCII classique.

> **Arbitrage tokens / compréhension** : le format le plus économe n'est pas le mieux compris. Sur un test de 11 formats (1 000 lignes, GPT-4.1 nano, [Improving Agents via Gigazine](https://gigazine.net/gsc_news/en/20251007-ai-table-format)), le Markdown clé-valeur obtient 60,7 % de bonnes réponses contre 44,3 % pour le CSV. Le format `compact` (défaut) est le bon choix pour le coût. Préférez `records` (paramètre `tableFormat`) quand la précision des réponses sur les tableaux prime.

---

## 5. Dimensionnement & Stratégie d'Overlap

| Paramètre API / UI | Défaut Doc2KB | Recommandation & source |
| :--- | :---: | :--- |
| `chunkMaxTokens` | **600** | 512 tokens = défaut validé par le benchmark FloTorch 2026. 256-512 pour des questions factuelles, 512-1 024 pour l'analytique / multi-hop (NVIDIA). |
| `chunkMinTokens` | **150** | Les fragments trop courts font chuter la précision finale (voir § 2). `0` = un chunk par titre. |
| `chunkOverlapTokens` | **15 % de `chunkMaxTokens`** (90) | NVIDIA (FinanceBench) a testé 10/15/20 % : 15 % est l'optimum. Azure suggère 25 % comme point de départ prudent. `0` désactive. |

Le chevauchement s'applique entre deux morceaux **d'une même section** découpée. Il reprend les derniers paragraphes entiers qui tiennent dans le budget, sinon les dernières **phrases** du paragraphe précédent. Il ne reprend jamais un fragment de code ou de tableau.

> **Faut-il seulement un RAG ?** Sous ~**200 000 tokens** (~500 pages), Anthropic recommande de charger tout le corpus dans le prompt avec le *prompt caching* plutôt que de faire de la recherche. Doc2KB Studio calcule cette recommandation (`contextStrategy` dans `manifest.json`, dans la réponse de `/api/convert-batch` et dans les notes de `llms.txt`) : `full_context` → `llms-full.txt`, `rag` → `rag-chunks.jsonl`.

---

## 6. Format JSONL & Intégration Vectorielle

Doc2KB Studio génère nativement un fichier standardisé **`rag-chunks.jsonl`** dont chaque ligne correspond à un document JSON indépendant, prêt à être ingéré dans n'importe quel Vector Store :

```jsonl
{"id":"doc_1_c1","doc_id":"doc_1","doc_title":"Guide","title":"Intro","breadcrumbs":"Guide > Intro","token_count":180,"text":"# Intro\n...","embedding_text":"Guide > Intro\n\n# Intro\n..."}
{"id":"doc_1_c2","doc_id":"doc_1","doc_title":"Guide","title":"Setup","breadcrumbs":"Guide > Setup","token_count":240,"text":"## Setup\n...","embedding_text":"Guide > Setup\n\n## Setup\n..."}
```

### Exemple d'Ingestion Python (ChromaDB / Pinecone) :

```python
import json
import chromadb
from chromadb.utils import embedding_functions

client = chromadb.PersistentClient(path="./chroma_db")
collection = client.get_or_create_collection(name="kb_entreprise")

documents, metadatas, ids = [], [], []

with open("rag-chunks.jsonl", "r", encoding="utf-8") as f:
    for line in f:
        chunk = json.loads(line)
        ids.append(chunk["id"])
        # embedding_text = fil d'Ariane + contenu : c'est lui qu'on embedde
        documents.append(chunk["embedding_text"])
        metadatas.append({
            "doc_id": chunk["doc_id"],
            "title": chunk["title"],
            "tokens": chunk["token_count"],
            "text": chunk["text"],  # texte propre à réinjecter dans le prompt
        })

collection.add(ids=ids, documents=documents, metadatas=metadatas)
print(f"✅ {len(ids)} chunks sémantiques indexés avec succès.")
```

---

## 7. Architecture en 2 Étapes : Bi-Encoder + Cross-Encoder Reranker

Pour atteindre l'état de l'art en production, Doc2KB Studio prépare le terrain pour le pipeline recommandé par l'industrie :

```
Query Utilisateur
       │
       ▼
[Étape 1 : Récupération Large (Hybride)]
Embeddings (cosinus) + BM25 sur embedding_text, fusion des rangs (RRF) -> Top ~150 candidats
       │
       ▼
[Étape 2 : Reranking Précis (Cross-Encoder)]
Modèle de reclassement (ex: Cohere Rerank, Voyage rerank, bge-reranker) -> Top ~20
       │
       ▼
[Étape 3 : Injection dans le LLM]
Les chunks retenus (champ `text`) sont transmis au modèle
```

Les chiffres d'Anthropic : la recherche hybride embeddings + BM25 bat chacune des deux méthodes seule (BM25 retrouve les correspondances exactes : codes d'erreur, références, noms propres). Transmettre les **20 meilleurs** chunks a donné de meilleurs résultats que 5 ou 10. Le nombre optimal dépend toutefois du corpus, et les études sur le *context rot* (Chroma, 2025) montrent que chaque token de contexte en trop dégrade la réponse : mesurez sur votre propre jeu d'évaluation (voir [guide 6](06-external-tools-and-monitoring.md)).
