import 'package:freezed_annotation/freezed_annotation.dart';

part 'balance_state.freezed.dart';

@freezed
class BalanceState with _$BalanceState {
  const factory BalanceState({
    double? balanceUsdc,
    @Default(false) bool promoActive,
    double? promoCreditUsdc,
    @Default(true) bool isLoading,
    String? error,
    double? previousBalance,
  }) = _BalanceState;
}
