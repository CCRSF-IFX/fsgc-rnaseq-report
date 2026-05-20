# AI Assistant

The AI assistant module is optional and disabled by default:

```json
{
  "ai": {
    "enabled": false
  }
}
```

When disabled, the report renders without the assistant UI. This makes it
possible to build reports that do not include AI functionality.

## Local OpenAI-Compatible Endpoint

When enabled, the module is designed to call an OpenAI-compatible local endpoint
such as an `openai-oauth` proxy running at:

```text
http://127.0.0.1:10531/v1
```

The report should not contain OAuth tokens or API keys. Authorization belongs in
the separately running local proxy or model service.

## Prompt Fallback

Reports should remain useful when a model endpoint is unavailable. A practical
fallback is to show the user a ready-to-copy prompt that summarizes the current
report context and asks for the desired interpretation. The user can paste that
prompt into ChatGPT or another approved model interface.

This mirrors the strategy used by tools such as MultiQC: connect directly when
a configured model endpoint is available, and provide a transparent prompt when
it is not.

## Privacy Notes

Before enabling model calls for a delivered report, review:

- Whether sample names, gene lists, or QC notes contain sensitive information.
- Whether the local proxy sends data to a hosted provider or local model.
- Whether the report user needs a visible warning before sending context.
- Whether the target environment permits browser calls to localhost services.

The safest default is to ship reports with AI disabled and enable the module
only for workflows where authorization, privacy, and endpoint availability are
understood.
