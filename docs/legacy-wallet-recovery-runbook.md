# Legacy Wallet Recovery Runbook

## Goal

Recover every remaining asset from `buyer-20260225`.

- ERC-20 assets move into the shared buyer wallet `0x728Eb75E5251f302885328d9480447AF7329c237`
- Native ETH uses the official Virtuals withdraw/support path

## ERC-20 Lane

The automated lane uses `o2o-printful-hub` as a controlled seller and `buyer-20260225` as the buyer.

Run:

```bash
cd /Users/daeyounglee/virtuals-protocol-acp-buyer
npm run legacy:recover -- --apply
```

Behavior:

- Reads the legacy buyer key from the secure local backup config only
- Reads `OPS_BUYER_HUB_API_KEY` from `/Users/daeyounglee/virtual/.env`
- Writes a recovery manifest and support brief into `logs/`
- Registers the temporary `legacy_wallet_pull_funds_v1` offering
- Runs one asset at a time in this order:
  - `USDC`
  - `VIRTUAL`
  - `POD`
  - `0xe036476ba1f23e072176a40f6340a1b22162cd40`
- Deletes the remote recovery offering after the last asset or on failure
- Skips residual ERC-20 dust below ACP transfer precision and leaves it in the support brief

Success criteria:

- Shared wallet balance increases for each ERC-20 asset
- Legacy wallet retains only native ETH

Precision note:

- ACP practical transfer precision is `6` decimal places
- Residual balances below that precision are not retried automatically
- Current observed residual: `0.000000512829051883 VIRTUAL`
- That residual now belongs in the native/support lane, not the automated lane

## Native ETH Lane

Do not use ACP for native ETH.

Observed ACP failures:

- `tokenAddress = null` is rejected
- `tokenAddress = 0x0000000000000000000000000000000000000000` is rejected

Official recovery order:

1. Try to log into the legacy Virtuals owner/profile and open the Wallet Management page.
2. If `buyer-20260225` is visible, use the official `Withdraw` function to move native ETH into the connected wallet.
3. Forward that ETH into the chosen recovery sink.
4. If the legacy owner/profile is not visible, submit a support ticket and request:
   - restored visibility, or
   - agent transfer to a fresh owner wallet, or
   - manual ETH withdrawal assistance

Official references:

- https://whitepaper.virtuals.io/about-virtuals/agent-commerce-protocol-acp/a-builders-guide-to-the-butler-agent
- https://whitepaper.virtuals.io/acp-product-resources/acp-openclaw-dev-onboarding-guide/set-up-agent-profile/register-agent
- https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/tips-and-troubleshooting/emergency-actions-for-compromised-wallets
- https://help.virtuals.io/submit-ticket

## Support Ticket Payload

Use the generated `logs/legacy_wallet_support_brief_*.md` file.

It includes:

- legacy agent name
- legacy wallet address
- current vs legacy session user IDs
- remaining native ETH amount
- list of already recovered ERC-20 assets
- explicit request to restore visibility, transfer the agent, or manually withdraw ETH

## Cleanup

- confirm the temporary recovery offering is removed from ACP
- confirm there is no seller runtime left running locally
- confirm the latest summary file exists in `logs/`
