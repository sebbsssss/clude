import 'package:freezed_annotation/freezed_annotation.dart';

part 'responses.freezed.dart';
part 'responses.g.dart';

@freezed
class AutoRegisterResponse with _$AutoRegisterResponse {
  const factory AutoRegisterResponse({
    @JsonKey(name: 'api_key') required String apiKey,
    @JsonKey(name: 'agent_id') required String agentId,
    required bool created,
  }) = _AutoRegisterResponse;

  factory AutoRegisterResponse.fromJson(Map<String, dynamic> json) =>
      _$AutoRegisterResponseFromJson(json);
}

@freezed
class Balance with _$Balance {
  const factory Balance({
    @JsonKey(name: 'balance_usdc') required double balanceUsdc,
    @JsonKey(name: 'wallet_address') required String walletAddress,
    bool? promo,
    @JsonKey(name: 'promo_credit_usdc') double? promoCreditUsdc,
  }) = _Balance;

  factory Balance.fromJson(Map<String, dynamic> json) =>
      _$BalanceFromJson(json);
}

@freezed
class TopupIntent with _$TopupIntent {
  const factory TopupIntent({
    required String id,
    @JsonKey(name: 'wallet_address') required String walletAddress,
    @JsonKey(name: 'amount_usdc') required double amountUsdc,
    required String chain,
    @JsonKey(name: 'dest_address') required String destAddress,
    @JsonKey(name: 'solana_pay_url') String? solanaPayUrl,
    String? reference,
  }) = _TopupIntent;

  factory TopupIntent.fromJson(Map<String, dynamic> json) =>
      _$TopupIntentFromJson(json);
}

@freezed
class TopupConfirmation with _$TopupConfirmation {
  const factory TopupConfirmation({
    required String status,
    @JsonKey(name: 'balance_usdc') required double balanceUsdc,
  }) = _TopupConfirmation;

  factory TopupConfirmation.fromJson(Map<String, dynamic> json) =>
      _$TopupConfirmationFromJson(json);
}

@freezed
class TopupStatus with _$TopupStatus {
  const factory TopupStatus({
    required String status,
    @JsonKey(name: 'amount_usdc') double? amountUsdc,
    @JsonKey(name: 'tx_hash') String? txHash,
    @JsonKey(name: 'balance_usdc') double? balanceUsdc,
  }) = _TopupStatus;

  factory TopupStatus.fromJson(Map<String, dynamic> json) =>
      _$TopupStatusFromJson(json);
}

@freezed
class ImportResult with _$ImportResult {
  const factory ImportResult({
    required int imported,
  }) = _ImportResult;

  factory ImportResult.fromJson(Map<String, dynamic> json) =>
      _$ImportResultFromJson(json);
}

@freezed
class MessageReceipt with _$MessageReceipt {
  const factory MessageReceipt({
    @JsonKey(name: 'cost_usdc') required double costUsdc,
    @JsonKey(name: 'equivalent_direct_cost') required double equivalentDirectCost,
    @JsonKey(name: 'savings_pct') required double savingsPct,
    @JsonKey(name: 'remaining_balance') double? remainingBalance,
  }) = _MessageReceipt;

  factory MessageReceipt.fromJson(Map<String, dynamic> json) =>
      _$MessageReceiptFromJson(json);
}

@freezed
class StreamDoneData with _$StreamDoneData {
  const factory StreamDoneData({
    required bool done,
    @JsonKey(name: 'message_id') String? messageId,
    String? model,
    @JsonKey(name: 'memories_used') int? memoriesUsed,
    @JsonKey(name: 'memory_ids') List<int>? memoryIds,
    Map<String, dynamic>? cost,
    Map<String, dynamic>? tokens,
    MessageReceipt? receipt,
  }) = _StreamDoneData;

  factory StreamDoneData.fromJson(Map<String, dynamic> json) =>
      _$StreamDoneDataFromJson(json);
}

@freezed
class TemporalSpan with _$TemporalSpan {
  const factory TemporalSpan({
    required int weeks,
    @JsonKey(name: 'since_label') required String sinceLabel,
  }) = _TemporalSpan;

  factory TemporalSpan.fromJson(Map<String, dynamic> json) =>
      _$TemporalSpanFromJson(json);
}

@freezed
class GreetingMeta with _$GreetingMeta {
  const factory GreetingMeta({
    @JsonKey(name: 'total_memories') required int totalMemories,
    @JsonKey(name: 'memories_recalled') required int memoriesRecalled,
    @JsonKey(name: 'temporal_span') TemporalSpan? temporalSpan,
    required List<String> topics,
    @JsonKey(name: 'greeting_cost') required double greetingCost,
  }) = _GreetingMeta;

  factory GreetingMeta.fromJson(Map<String, dynamic> json) =>
      _$GreetingMetaFromJson(json);
}
