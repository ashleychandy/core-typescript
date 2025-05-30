export interface QuoteRequest {
    from_address: string;
    from_asset: string;
    to_asset: string;
    to_address: string;
    from_value: string;
    referral_address: string;
    referral_bps: number;
    slippage_bps: number;
}

export interface ReferralAddress {
    evm?: string;
    solana?: string;
    sui?: string;
    ton?: string;
}

export interface Quote {
    quote: QuoteRequest;
    output_value: string;
    output_min_value: string;
    route_data: object;
    eta_in_seconds?: number;
}

export interface QuoteDataRequest {
    quote: Quote;
}

export interface QuoteData {
    to: string;
    value: string;
    data: string;
}
