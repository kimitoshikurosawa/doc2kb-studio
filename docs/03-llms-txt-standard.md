# 📑 Spécification & Implémentation de la Norme llms.txt

> **Le standard émergent pour l'indexation IA, les agents autonomes et l'optimisation GEO (Generative Engine Optimization).**

---

## 📑 Table des Matières
1. [Qu'est-ce que la norme llms.txt ?](#1-quest-ce-que-la-norme-llmstxt-)
2. [llms.txt vs robots.txt vs sitemap.xml](#2-llmstxt-vs-robotstxt-vs-sitemapxml)
3. [Anatomie Formelle d'un Fichier llms.txt](#3-anatomie-formelle-dun-fichier-llmstxt)
4. [La Famille des Fichiers Compagnons](#4-la-famille-des-fichiers-compagnons)
5. [Le concept de GEO (Generative Engine Optimization)](#5-le-concept-de-geo-generative-engine-optimization)
6. [Automatisation avec Doc2KB Studio](#6-automatisation-avec-doc2kb-studio)
7. [Déploiement & Découverte HTTP](#7-déploiement--découverte-http)

---

## 1. Qu'est-ce que la norme llms.txt ?

Proposée en 2024 par **Jeremy Howard** (co-fondateur d'Answer.AI et de fast.ai), la convention **[llms.txt](https://llmstxt.org/)** est un standard communautaire visant à rendre les sites web et bases documentaires directement compréhensibles par les Large Language Models (LLMs) et les agents d'IA.

Alors que le web classique a été conçu pour l'affichage visuel humain (avec HTML, CSS, JavaScript, bannières de cookies et menus déroulants), les agents d'IA ont besoin d'une **information textuelle dense, structurée et sans bruit**.

`llms.txt` agit comme un **sommaire exécutif standardisé en Markdown pur**, placé à la racine d'un projet ou d'un domaine.

---

## 2. llms.txt vs robots.txt vs sitemap.xml

Pour bien positionner son rôle dans votre architecture :

| Fichier | Cible Principale | Fonction Essentielle | Philosophie |
| :--- | :--- | :--- | :--- |
| **`robots.txt`** | Crawlers classiques (Googlebot, Bingbot) | Contrôle d'accès & exclusion (pages privées) | **Restriction** |
| **`sitemap.xml`** | Moteurs d'indexation | Liste exhaustive des URLs d'un site web | **Inventaire technique** |
| **`llms.txt`** | Agents IA, LLMs & Moteurs génératifs | Sélection organisée du savoir fondamental | **Guidance sémantique** |

---

## 3. Anatomie Formelle d'un Fichier llms.txt

Un fichier `llms.txt` valide doit être encodé en UTF-8, utiliser la syntaxe Markdown standard et respecter la structure canonique suivante :

```markdown
# Nom du Projet ou de la Base de Connaissances

> Résumé concis en une ou deux phrases décrivant l'objectif fondamental, le public cible et le domaine couvert par la documentation.

## Documentation Fondamentale

- [Architecture Système](docs/architecture.md): Vue d'ensemble des composants et du pipeline de données (Tokens: ~1,200)
- [Guide de Déploiement](docs/deploiement.md): Procédure d'installation sur infrastructure Kubernetes ou Docker (Tokens: ~850)
- [Référence de l'API REST](docs/api-reference.md): Endpoints, schémas de requêtes et codes de retour HTTP (Tokens: ~2,400)

## Guides Métiers & Politiques Internes

- [Politique de Sécurité des Données](docs/securite.md): Gestion des habilitations et conformité RGPD (Tokens: ~600)
- [Procédure de Sauvegarde](docs/backups.md): Stratégie de rétention et tests de reprise d'activité (Tokens: ~400)

## Spécifications & Mots-Clés

Keywords: RAG, FinOps, Token-Reduction, BPE, Vector-Search, Embeddings, Docker

## Notes d'Ingestion pour Agents IA

- Fichier d'index conforme à la spécification https://llmstxt.org/
- Pour ingérer l'intégralité du corpus en un seul appel, consultez `llms-full.txt`.
- Pour une base vectorielle, utilisez les chunks prêts à l'emploi dans `rag-chunks.jsonl`.
```

### Règles de Structure :
1. **Un seul Titre H1** : Identifie sans ambiguïté le système ou l'organisation.
2. **Un Blockquote Immédiat (`>`)** : Résumé fondamental capté prioritairement par le modèle.
3. **Sections H2** : Regroupement thématique logique des ressources.
4. **Format de Lien Strict** : `- [Titre de la ressource](URL): Description courte du contenu`.

---

## 4. La Famille des Fichiers Compagnons

Pour s'adapter à toutes les tailles de contexte (petits modèles comme Llama 3 8B ou géants comme Gemini 1.5 Pro et Claude 3.5 Sonnet), l'écosystème utilise une trilogie de fichiers :

```
┌─────────────────────────────────────────────────────────────┐
│ 📑 llms.txt (Index Léger - 500 à 2 000 tokens)              │
│ -> Utilisé par l'agent pour décider quels liens explorer.    │
└──────────────────────────────┬──────────────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌───────────────────────────────┐     ┌────────────────────────────────┐
│ ⚡ llms-small.txt              │     │ 📚 llms-full.txt               │
│ (Digest - 2k à 8k tokens)     │     │ (Corpus Complet - 50k à 500k)  │
│ Résumé exécutif de chaque     │     │ Concaténation intégrale épurée │
│ document pour agents rapides. │     │ pour modèles à contexte long.  │
└───────────────────────────────┘     └────────────────────────────────┘
```

Doc2KB Studio génère **automatiquement ces 3 variantes** lors de la création d'une base de connaissances.

---

## 5. Le concept de GEO (Generative Engine Optimization)

De la même manière que le **SEO** visait à plaire aux algorithmes de Google dans les années 2000-2020, le **GEO** (*Generative Engine Optimization*) vise à s'assurer que les modèles génératifs (ChatGPT Search, Perplexity, Claude, Copilot) comprennent et citent fidèlement vos documentations.

### Pourquoi `llms.txt` maximise votre GEO :
1. **Zéro Bruit** : Aucun script tiers, menu de navigation ou publicité ne vient distraire l'attention du modèle.
2. **Attribution Claire** : Chaque lien est explicitement décrit avec son URL canonique, facilitant les citations de sources par l'IA.
3. **Densité d'Information Maximale** : Le ratio tokens utiles / tokens totaux est proche de 98%.

---

## 6. Automatisation avec Doc2KB Studio

Ne rédigez pas ces fichiers manuellement. Doc2KB Studio intègre un compilateur complet dans [`lib/llmsTxtGenerator.js`](file:///mnt/BACKUP/transformation/lib/llmsTxtGenerator.js) :

```javascript
const { generateLlmsTxt, generateLlmsFullTxt } = require('./lib/llmsTxtGenerator');

const documents = [
  { filename: 'guide.md', markdown: '# Guide...', title: 'Guide Utilisateur' },
  { filename: 'api.md', markdown: '# API...', title: 'Spécification API' }
];

// Génère la version standard llmstxt.org
const indexFile = generateLlmsTxt(documents, {
  projectTitle: "Doc2KB Studio Documentation",
  summary: "Bases de connaissances IA et réduction de tokens."
});

// Génère le corpus géant unifié
const fullCorpus = generateLlmsFullTxt(documents);
```

---

## 7. Déploiement & Découverte HTTP

Pour que les agents autonomes découvrent automatiquement votre documentation :

### A. Règle d'Emplacement
Servez le fichier à la racine de votre domaine ou sous-domaine :
```text
https://votredomaine.com/llms.txt
https://votredomaine.com/llms-full.txt
```

### B. Signalement dans le HTML
Dans le `<head>` de votre site principal, ajoutez la balise de découverte :
```html
<link rel="describedby" type="text/markdown" href="/llms.txt">
```

### C. En-Tête HTTP (Recommandé pour les API)
Configurez votre serveur web (Nginx, Express, Caddy) pour émettre l'en-tête suivant :
```http
Link: </llms.txt>; rel="describedby"; type="text/markdown"
```
Doc2KB Studio génère automatiquement cette structure prête à être déployée dans n'importe quel CDN ou serveur statique.
