# CSR & Sustainability Annotation Tool

**A web application for human annotation of sustainability communication in social media posts.**

This project supports a research workflow for manually examining CSR (corporate social responsibility) and sustainability-related content in Swedish forestry companies’ Instagram posts. Human coders review a post’s images and caption, assign sustainability dimensions, and save their annotations for subsequent analysis.

> **Scope:** This is a **human-coding interface**, not an automated AI/ML classifier. It does not independently evaluate AI models or calculate inter-coder reliability statistics.

## Features

- **Multimodal annotation:** Inspect post images (including multi-image posts) alongside captions.
- **Three coding perspectives:** Assign labels to **image only**, **caption only**, and **image + caption combined**.
- **Multi-label sustainability categories:** Select relevant dimensions or **None** for each perspective.
- **Coder-specific records:** Support separate annotations for Coder A and Coder B, with optional notes.
- **Progress tracking:** Track completed posts and resume from the first uncoded post.
- **Disagreement review:** Compare coders’ overall assessments and revisit posts where one coder identified sustainability content and the other did not.
- **Airtable integration:** Load posts and save annotation fields through the Airtable API.

The disagreement view focuses on **presence versus absence of sustainability content** in the combined image-and-caption assessment. It is not a full multi-label disagreement or reliability-analysis engine.

## Sustainability dimensions

The current interface provides the following options:

| Dimension | Dimension |
|---|---|
| Climate action | Biodiversity protection |
| Responsible management & operations | Circular practices |
| Renewable energy & bioeconomy | Community support |
| Employee wellbeing | Diversity & inclusion |
| Product responsibility | Certification & transparency |
| General sustainability claim | None |

## Technology stack

- **Backend:** Node.js and Express
- **Frontend:** HTML, CSS, and client-side JavaScript served by the Express application
- **Data access:** Airtable REST API via Axios
- **Configuration:** Environment variables for Airtable credentials and coder access tokens

## Repository structure

```text
Sustainability-Classification/
├── server.js       # Express API and embedded annotation interface
└── package.json    # Dependencies and run scripts
```

## Local setup (research use)

Requirements: Node.js 18+ and an Airtable base with compatible research records and fields.

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/shahinprez/Sustainability-Classification.git
   cd Sustainability-Classification
   npm install
   ```

2. Supply the required configuration through your local environment or an approved secrets manager:

   ```text
   AIRTABLE_API_KEY=<your Airtable token>
   AIRTABLE_BASE_ID=<your Airtable base ID>
   AIRTABLE_TABLE_NAME=ManualCoding
   CODER_A_TOKEN=<private coder A token>
   CODER_B_TOKEN=<private coder B token>
   ADMIN_TOKEN=<private test token>
   CODER_A_NAME=Coder A
   CODER_B_NAME=Coder B
   PORT=3000
   ```

   `AIRTABLE_TABLE_NAME`, coder display names, and `PORT` have defaults. **Set all access tokens explicitly. Do not commit actual credentials or research data.** The repository does not include an environment-file loader; configure variables in the process environment before starting.

3. Start the application:

   ```bash
   npm start
   ```

   The server defaults to `http://localhost:3000`. An authorized local research user needs a configured coder token to load posts. The current prototype uses URL-based token access; see the security notice below before exposing any deployment.

### Expected Airtable fields

The application reads image attachments and captions from compatible fields (for example, `Images` or `Attachments`, `Translated Caption` or `Caption`), with optional company and post-date metadata. It writes coder-specific fields such as:

- `CoderA_Image_Dimension`, `CoderA_Caption_Dimension`, `CoderA_Overall_Dimension`, `CoderA_note`
- `CoderB_Image_Dimension`, `CoderB_Caption_Dimension`, `CoderB_Overall_Dimension`, `CoderB_note`

These fields must exist in the connected Airtable table. A populated, compatible Airtable base is necessary to use the application as currently implemented; **no sample dataset is distributed in this repository**.

## Data, security, and limitations

- The source repository includes **no research dataset or API credentials**. It connects to data in a separately configured Airtable account.
- **This is a research prototype, not a production-hardened service.** The existing token-based access approach needs redesign before an internet-facing deployment, along with input validation, output escaping, access-control review, and appropriate logging safeguards.
- Do not connect a public demo to real research participants, confidential annotations, or restricted partner data. Use an independently created synthetic dataset for any public demonstration.
- The application performs human coding and a targeted disagreement review. Statistical inter-coder agreement and AI-model evaluation must be carried out separately.
- The code is provided for portfolio/documentation purposes; no open-source license is granted in this repository. Confirm institutional and third-party rights before reuse, redistribution, or further publication.

## Research context

Developed in the context of research on visual and textual sustainability communication in the Swedish forestry sector, including the use of human annotations to study CSR/sustainability signals across social media posts.

**Author:** Shahin Rezvanian — PhD Researcher, University of St. Gallen.
