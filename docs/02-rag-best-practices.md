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
2. **Regroupement cohérent** : Si une sous-section est trop courte (< 40 tokens), elle est fusionnée intelligemment avec son parent immédiat sans briser le fil logique.
3. **Sous-partitionnement contrôlé** : Si une section dépasse le plafond de tokens fixé (`chunkMaxTokens`, par ex. 600 tokens), elle est scindée uniquement aux frontières de paragraphes (`\n\n`), jamais au milieu d'une phrase.

---

## 3. L'Injection de Fil d'Ariane (*Breadcrumbs Context*)

Récemment popularisée par Anthropic sous le terme de **Contextual Retrieval**, l'injection d'un préfixe de contexte augmente de **35% à 50% la précision de recherche** sans alourdir le modèle d'embedding.

Doc2KB Studio calcule et injecte automatiquement l'arborescence complète dans chaque chunk :

```json
{
  "id": "manuel_tech_chunk_4",
  "doc_title": "Manuel d'Exploitation Cloud",
  "breadcrumbs": "Manuel d'Exploitation Cloud > Haute Disponibilité > Procédure de Failover",
  "token_count": 215,
  "text": "### Procédure de Failover\n\nEn cas de perte du nœud maître, la bascule s'effectue automatiquement sous 15 secondes..."
}
```

Lorsque l'utilisateur pose la question : *« Combien de temps prend la bascule du nœud maître ? »*, le modèle d'embedding fait le lien non seulement avec le mot "bascule", mais aussi avec les concepts "Manuel d'Exploitation", "Haute Disponibilité" et "Failover".

---

## 4. Traitement Atomique des Tableaux et Blocs de Code

Les données tabulaires et le code représentent l'information la plus dense et la plus fragile d'un document.

### Règles d'Or Implémentées :
1. **Les En-têtes Restent Soudés** :
   Une ligne de données de tableau n'est jamais isolée de sa ligne d'en-tête.
2. **Compactage des Séparateurs** :
   Les séparateurs de colonnes verbeux (`|:------------------|`) sont compressés en `|---|`.
3. **Mode Records pour la Recherche Sémantique** :
   Lorsqu'un tableau comporte plus de 8 colonnes, Doc2KB Studio peut le projeter sous forme de liste de fiches descriptives :
   ```markdown
   - [Fiche Serveur 1] IP: 10.0.0.1 | Rôle: Gateway | État: Actif
   - [Fiche Serveur 2] IP: 10.0.0.2 | Rôle: Database | État: Standby
   ```
   Ce format permet au modèle d'embedding de capter chaque attribut avec un score de similarité bien supérieur à un tableau ASCII classique.

---

## 5. Dimensionnement & Stratégie d'Overlap

| Métrique | Valeur Recommandée | Justification |
| :--- | :---: | :--- |
| **Taille Minimale** | 50 tokens | Évite les micro-chunks sans valeur informationnelle ("Voir annexe"). |
| **Taille Cible (Sweet Spot)** | **300 à 600 tokens** | Équilibre parfait entre granularité de recherche et richesse contextuelle. |
| **Taille Maximale** | 800 tokens | Au-delà, l'embedding moyen dilue l'information spécifique (*vector dilution*). |
| **Chevauchement (Overlap)** | 10% à 15% | Uniquement utile lors de la découpe interne de très longs paragraphes. |

---

## 6. Format JSONL & Intégration Vectorielle

Doc2KB Studio génère nativement un fichier standardisé **`rag-chunks.jsonl`** dont chaque ligne correspond à un document JSON indépendant, prêt à être ingéré dans n'importe quel Vector Store :

```jsonl
{"id":"doc_1_c1","doc_id":"doc_1","doc_title":"Guide","title":"Intro","breadcrumbs":"Guide > Intro","token_count":180,"text":"# Intro\n..."}
{"id":"doc_1_c2","doc_id":"doc_1","doc_title":"Guide","title":"Setup","breadcrumbs":"Guide > Setup","token_count":240,"text":"## Setup\n..."}
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
        # On concatène le fil d'Ariane au texte pour enrichir l'embedding
        documents.append(f"[{chunk['breadcrumbs']}]\n{chunk['text']}")
        metadatas.append({
            "doc_id": chunk["doc_id"],
            "title": chunk["title"],
            "tokens": chunk["token_count"]
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
[Étape 1 : Récupération Large (Dense Retrieval)]
Recherche vectorielle cosinus -> Top 30 candidats (rapide, peu coûteux)
       │
       ▼
[Étape 2 : Reranking Précis (Cross-Encoder)]
Modèle de reclassement (ex: Cohere Rerank ou bge-reranker-large) -> Top 5 pépites
       │
       ▼
[Étape 3 : Injection dans le LLM]
Seulement les 5 chunks les plus denses sont transmis à GPT-4o / Claude
-> Économie maximale de tokens et précision chirurgicale de la réponse !
```
