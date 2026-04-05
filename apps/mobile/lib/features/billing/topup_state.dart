import 'package:freezed_annotation/freezed_annotation.dart';

part 'topup_state.freezed.dart';

@freezed
sealed class TopupState with _$TopupState {
  const factory TopupState.idle() = TopupIdle;
  const factory TopupState.creatingIntent() = TopupCreatingIntent;
  const factory TopupState.awaitingPayment({
    required String intentId,
    required String destAddress,
    String? solanaPayUrl,
    required String chain,
  }) = TopupAwaitingPayment;
  const factory TopupState.confirmed({required double newBalance}) =
      TopupConfirmed;
  const factory TopupState.error({required String message}) = TopupError;
  const factory TopupState.timedOut() = TopupTimedOut;
}
