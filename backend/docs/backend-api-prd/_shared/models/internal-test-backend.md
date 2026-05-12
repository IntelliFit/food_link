# Internal Test Backend

| Model | Fields | Source |
| --- | --- | --- |
| `PromptCreate` | model_type, prompt_name, prompt_content, description, is_active | `backend/main.py:12066` |
| `PromptUpdate` | prompt_name, prompt_content, description | `backend/main.py:12074` |
| `TestBackendLoginRequest` | username, password | `backend/main.py:10885` |
| `TestBackendLocalDatasetImportRequest` | name, source_dir, description | `backend/main.py:10890` |
