import { TonClient } from "@ton/ton";
import { DEX, pTON } from "@ston-fi/sdk";
import { StonApiClient } from '@ston-fi/api';
import { QuoteRequest, Quote, QuoteData, Asset, Chain } from "@gemwallet/types";
import { Protocol } from "../protocol";

const client = new StonApiClient();

const TON_JETTON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const PTON_VERSION_1 = "EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez";
const PTON_VERSION_2_1 = "EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S";

function getTokenAddress(asset: Asset): string {
    return asset.isNative() ? TON_JETTON_ADDRESS : asset.tokenId ?? '';
}

export class StonfiProvider implements Protocol {
    private endpoint: string;

    constructor(endpoint: string) {
        this.endpoint = endpoint;
    }

    async get_quote(quoteRequest: QuoteRequest): Promise<Quote> {
        const fromAsset = Asset.fromString(quoteRequest.from_asset.asset_id)
        const toAsset = Asset.fromString(quoteRequest.to_asset.asset_id)

        if (fromAsset.chain != Chain.Ton || toAsset.chain != Chain.Ton) {
            throw new Error("Only TON is supported");
        }

        const swapDirectSimulation = await client.simulateSwap({
            offerAddress: getTokenAddress(fromAsset),
            offerUnits: quoteRequest.from_value,
            askAddress: getTokenAddress(toAsset),
            slippageTolerance: (quoteRequest.slippage_bps / 10000).toString(),
            referralAddress: quoteRequest.referral?.address?.ton,
            referralFeeBps: quoteRequest.referral?.bps?.toString(),
        });

        console.log("swapDirectSimulation", swapDirectSimulation);

        return {
            quote: quoteRequest,
            output_value: swapDirectSimulation.askUnits,
            output_min_value: swapDirectSimulation.minAskUnits,
            route_data: {},
            eta_in_seconds: 3 // https://tonscan.org/blocks
        }
    }

    async get_quote_data(quote: Quote): Promise<QuoteData> {
        const fromAsset = Asset.fromString(quote.quote.from_asset.asset_id)
        const toAsset = Asset.fromString(quote.quote.to_asset.asset_id)
        const fromTokenAdddress = getTokenAddress(fromAsset)
        const toTokenAddress = getTokenAddress(toAsset)
        let routers = await client.getRouters();
        let pools = await client.getPoolsByAssetPair({
            asset0Address: fromTokenAdddress,
            asset1Address: toTokenAddress
        });
        const pool = pools[0];
        if (!pool) {
            throw new Error("No valid pools");
        }
        const router = routers.find(r => r.address === pool.routerAddress);
        if (!router) {
            throw new Error("No matching router found");
        }

        // only support v2
        const dexRouterInstance = (() => {
            switch (true) {
                case router.majorVersion === 1:
                    return DEX.v1.Router.create(router.address);
                case router.majorVersion === 2 && router.minorVersion === 1:
                    return DEX.v2_1.Router.create(router.address);
                case router.majorVersion === 2 && router.minorVersion === 2:
                    return DEX.v2_2.Router.create(router.address);
                default:
                    throw new Error("Router version not supported");
            }
        })();
        const proxyTon = (() => {
            switch (true) {
                case router.majorVersion === 1:
                    return pTON.v1.create(PTON_VERSION_1);
                case router.majorVersion === 2:
                    return pTON.v2_1.create(PTON_VERSION_2_1);
                default:
                    throw new Error("Pton version not supported");
            }
        })();
        const routerClient = new TonClient({ endpoint: this.endpoint + "/api/v2/jsonRPC" }).open(dexRouterInstance);

        if (pool.lpTotalSupplyUsd && parseFloat(pool.lpTotalSupplyUsd) < 1000) {
            throw new Error("Pool liquidity is too low.");
        }

        const referralAddress = quote.quote.referral?.address?.ton;
        const referralValue = quote.quote.referral?.bps;

        if (fromAsset.isNative()) {
            const params = await routerClient.getSwapTonToJettonTxParams({
                userWalletAddress: quote.quote.from_address,
                proxyTon,
                offerAmount: quote.quote.from_value,
                askJettonAddress: toTokenAddress,
                minAskAmount: quote.output_min_value,
                deadline: Math.floor(Date.now() / 1000) + 60 * 1000,
                referralAddress: referralAddress,
                referralValue: referralValue,
            });

            if (!params.body) {
                throw new Error('Transaction body is required');
            }

            return {
                to: params.to.toString(),
                value: params.value.toString(),
                data: params.body.toBoc().toString('base64')
            };
        } else if (toAsset.isNative()) {
            const params = await routerClient.getSwapJettonToTonTxParams({
                userWalletAddress: quote.quote.from_address,
                proxyTon,
                offerJettonAddress: fromTokenAdddress,
                offerAmount: quote.quote.from_value,
                minAskAmount: quote.output_min_value,
                referralAddress: referralAddress,
                referralValue: referralValue,
            });

            if (!params.body) {
                throw new Error('Transaction body is required');
            }

            return {
                to: params.to.toString(),
                value: params.value.toString(),
                data: params.body.toBoc().toString('base64')
            };
        } else {
            const params = await routerClient.getSwapJettonToJettonTxParams({
                userWalletAddress: quote.quote.from_address,
                offerJettonAddress: fromTokenAdddress,
                offerAmount: quote.quote.from_value,
                askJettonAddress: toTokenAddress,
                minAskAmount: quote.output_min_value,
                referralAddress: referralAddress,
                referralValue: referralValue,
            });

            if (!params.body) {
                throw new Error('Transaction body is required');
            }

            return {
                to: params.to.toString(),
                value: params.value.toString(),
                data: params.body.toBoc().toString('base64')
            };
        }
    }
}
