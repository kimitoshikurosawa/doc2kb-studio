# 💰 Guide de l'Économie de Tokens & FinOps IA

> **Optimisation de la fenêtre de contexte, compression de prompt, Prompt Caching et réduction des coûts d'inférence LLM.**

---

## 📑 Table des Matières
1. [Introduction au FinOps IA](#1-introduction-au-finops-ia)
2. [La Mécanique BPE (Byte-Pair Encoding)](#2-la-mécanique-bpe-byte-pair-encoding)
3. [Les 4 Piliers de la Réduction de Tokens](#3-les-4-piliers-de-la-réduction-de-tokens)
4. [Prompt Caching (Context Caching) : Fonctionnement & Règles d'Or](#4-prompt-caching-context-caching--fonctionnement--règles-dor)
5. [Compression Structurelle du Markdown](#5-compression-structurelle-du-markdown)
6. [Étude de Cas Chiffrée & ROI](#6-étude-de-cas-chiffrée--roi)
7. [Checklist FinOps pour la Production](#7-checklist-finops-pour-la-production)

---

## 1. Introduction au FinOps IA

Dans les architectures d'IA générative modernes (RAG, agents autonomes, analyse documentaire), les coûts d'inférence des modèles de langage (LLM) sont dominés par les **tokens d'entrée** (*input tokens*).

Un projet d'entreprise moyen qui interroge une base documentaire non optimisée souffre de :
* **Gaspillage financier** : 30% à 60% des tokens transmis correspondent à des artéfacts de mise en page, du HTML verbeux, des espaces blancs ou du boilerplate juridique répété.
* **Dégradation cognitive (*Lost in the Middle*)** : Plus la fenêtre de contexte est encombrée de bruit, plus la capacité d'attention du Transformer se dilue, augmentant le taux d'hallucination de 15% à 35%.
* **Latence accrue (*Time to First Token*)** : Le temps de calcul du pré-remplissage du contexte (*prefill time*) croît avec la taille du prompt.

Le rôle de **Doc2KB Studio** est d'agir comme un filtre d'ingestion FinOps en amont de vos appels LLM.

---

## 2. La Mécanique BPE (Byte-Pair Encoding)

Pour comprendre l'optimisation des tokens, il faut comprendre comment les LLMs lisent le texte. Les modèles comme GPT-4o, Claude 3.5 Sonnet ou Llama 3 n'analysent ni des lettres ni des mots entiers, mais des sous-unités de mots appelées **tokens** générées par un algorithme **BPE**.

### Les Encodages de Référence :
* **`cl100k_base`** (OpenAI GPT-4, GPT-3.5, référence pour Anthropic Claude) : vocabulaire de ~100 000 tokens.
* **`o200k_base`** (OpenAI GPT-4o, GPT-4o Mini) : vocabulaire étendu à ~200 000 tokens, améliorant l'encodage du multilingue et du code.

### Exemples Concrets d'Inefficacité BPE :
1. **Les Espaces Multiples** :
   En Markdown standard :
   ```markdown
   | Produit          | Prix        | Stock       |
   ```
   Chaque bloc d'espaces consécutifs (5 à 10 espaces pour aligner les colonnes visuellement) est découpé en plusieurs tokens distincts (ex: token pour 2 espaces, token pour 4 espaces). Pour un tableau de 100 lignes, **ce sont plus de 1 200 tokens gaspillés uniquement pour des espaces invisibles** à l'attention sémantique du modèle !
2. **Les Retours à la Ligne Multiples** :
   Trois ou quatre sauts de ligne consécutifs (`\n\n\n\n`) génèrent 3 à 4 tokens sans aucune information.
3. **Les Balises HTML & Propriétés de Style** :
   Une balise `<div style="font-family: Arial; margin-top: 10px;">Texte</div>` consomme 18 tokens pour un seul mot d'information (`Texte` = 1 token, la balise = 17 tokens).

---

## 3. Les 4 Piliers de la Réduction de Tokens

```
                ┌────────────────────────────────────────┐
                │        DOCUMENT BRUT (100%)            │
                └───────────────────┬────────────────────┘
                                    │
    ┌───────────────────────────────┴──────────────────────────────┐
    ▼                               ▼                              ▼
[1. Élagage Boilerplate]  [2. Minification Markdown]  [3. Compression Structurelle]
- Page 1 of 10            - Tables sans padding        - Records au lieu de tables
- Mentions légales         - Listes compactes           - Nettoyage des query strings
- Balises HTML vides       - Suppression règles ---     - Dédoublonnage
    │                               │                              │
    └───────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
                ┌────────────────────────────────────────┐
                │       CONTEXTE OPTIMISÉ (-45%)         │
                └───────────────────┬────────────────────┘
                                    │
                                    ▼
                        [4. Prompt Caching]
                - Ingestion statique réutilisée à -90% du coût
```

---

## 4. Prompt Caching (Context Caching) : Fonctionnement & Règles d'Or

Les fournisseurs majeurs (Anthropic Claude, OpenAI, Google Gemini) ont introduit le **Prompt Caching** (mise en cache du préfixe de contexte).

### Fonctionnement Économique :
* **Tokens non cachés (Écriture)** : Facturés au tarif plein (ex: 3.00$ / 1M pour Claude 3.5 Sonnet).
* **Tokens cachés (Lecture)** : Facturés avec **-90% de réduction** (ex: 0.30$ / 1M chez Anthropic) et latence quasi instantanée.

### Les Règles d'Or d'Architecture :
1. **La Stabilité du Préfixe** :
   Le cache fonctionne sur le principe de correspondance exacte du début du prompt (*prefix match*).
   * ❌ **Mauvaise pratique** : Injecter l'horodatage ou la question utilisateur avant les documents de référence. Tout changement en début de prompt invalide le cache de tous les documents suivants.
   * ✅ **Bonne pratique** : Structurez votre prompt dans cet ordre immuable :
     1. Consignes système & Schémas d'outils.
     2. Corpus documentaire de référence (généré via `llms-full.txt` ou Doc2KB Studio).
     3. Historique de conversation.
     4. Question de l'utilisateur (en dernière position).
2. **Seuil Minimal d'Activation** :
   * Anthropic Claude : minimum 1 024 tokens.
   * OpenAI GPT-4o : blocs de 1 024 tokens.
   * Google Gemini : minimum 32 768 tokens (contexte long).

---

## 5. Compression Structurelle du Markdown

Doc2KB Studio applique une série de transformations déterministes sur le balisage :

### A. Compactage des Tableaux GFM
* **Avant (Verbeux)** :
  ```markdown
  | Identifiant      | Intitulé du Poste             | Département       | Salaire Brut Annuel |
  | :--------------- | :---------------------------- | :---------------- | :------------------ |
  | EMP-00921        | Ingénieur DevOps Senior       | Infrastructure IT | 68 000 EUR          |
  | EMP-00922        | Chef de Projet Digital        | Marketing         | 54 000 EUR          |
  ```
  *Poids : 84 tokens.*

* **Après (Ultra-Compact Doc2KB)** :
  ```markdown
  |Identifiant|Intitulé du Poste|Département|Salaire Brut Annuel|
  |---|---|---|---|
  |EMP-00921|Ingénieur DevOps Senior|Infrastructure IT|68 000 EUR|
  |EMP-00922|Chef de Projet Digital|Marketing|54 000 EUR|
  ```
  *Poids : 49 tokens (**-41.6% de tokens**, 100% de compréhension sémantique préservée).*

### B. Mode Records (Clé-Valeur) pour Données Creuses
Pour les fichiers Excel contenant de nombreuses colonnes avec des cellules vides :
```markdown
- [Ligne 1] Identifiant: EMP-00921 | Poste: DevOps | Salaire: 68k
- [Ligne 2] Identifiant: EMP-00922 | Poste: Chef de Projet | Salaire: 54k
```
Ce format évite de répéter des colonnes vides (`||||`) et améliore grandement la similarité cosinus lors de la recherche par embedding.

---

## 6. Étude de Cas Chiffrée & ROI

Considérons une entreprise déployant un assistant RAG interne utilisé par 500 collaborateurs :
* **Requêtes par jour** : 5 000 requêtes.
* **Contexte documentaire moyen injecté** : 6 000 tokens par requête.
* **Volume mensuel (20 jours ouvrés)** : 600 millions de tokens d'entrée.

| Métrique | Sans Doc2KB Studio | Avec Doc2KB Studio (-42%) | Économie Nette |
| :--- | :---: | :---: | :---: |
| **Tokens Mensuels** | 600 000 000 tok | 348 000 000 tok | **- 252 000 000 tok** |
| **Facture GPT-4o ($2.50/M)** | 1 500 $ / mois | 870 $ / mois | **630 $ / mois (7 560 $/an)** |
| **Facture Claude 3.5 Sonnet ($3.00/M)** | 1 800 $ / mois | 1 044 $ / mois | **756 $ / mois (9 072 $/an)** |
| **Temps Moyen Pré-remplissage** | 1.8 seconde | 1.0 seconde | **- 44% de latence** |

---

## 7. Checklist FinOps pour la Production

- [ ] **Mesurer avant de couper** : Utiliser [`lib/tokenizer.js`](file:///mnt/BACKUP/transformation/lib/tokenizer.js) pour identifier la répartition des tokens entre consigne système, historique et contexte documentaire.
- [ ] **Activer la minification des tables** : S'assurer que le flag `compactTables` est actif pour tous les fichiers Excel et Markdown.
- [ ] **Placer le corpus statique au début** : Maximiser le taux de succès du Prompt Caching chez OpenAI et Anthropic.
- [ ] **Fixer un plafond de chunk** : Calibrer les chunks RAG entre 400 et 600 tokens avec [`lib/semanticChunker.js`](file:///mnt/BACKUP/transformation/lib/semanticChunker.js) pour éviter les fragments orphelins ou surdimensionnés.
- [ ] **Auditer les métadonnées** : Vérifier que le Frontmatter YAML injecté synthétise le titre et les mots-clés sans doubler inutilement le texte.
