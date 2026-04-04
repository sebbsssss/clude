import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import 'balance_state.dart';

final balanceNotifierProvider =
    StateNotifierProvider<BalanceNotifier, BalanceState>(
  (ref) => BalanceNotifier(ref),
);

class BalanceNotifier extends StateNotifier<BalanceState>
    with WidgetsBindingObserver {
  BalanceNotifier(this._ref, {bool skipInit = false})
      : super(const BalanceState()) {
    if (!skipInit) {
      WidgetsBinding.instance.addObserver(this);
      fetchBalance();
      startPolling();
    }
  }

  final Ref _ref;
  Timer? _pollTimer;
  static const _pollInterval = Duration(seconds: 30);

  Future<void> fetchBalance() async {
    try {
      final client = _ref.read(apiClientProvider);
      final balance = await client.getBalance();
      if (!mounted) return;

      final previous = state.balanceUsdc;
      state = state.copyWith(
        balanceUsdc: balance.balanceUsdc,
        promoActive: balance.promo ?? false,
        promoCreditUsdc: balance.promoCreditUsdc,
        isLoading: false,
        error: null,
        previousBalance: previous,
      );
    } catch (e) {
      if (!mounted) return;
      // Retain cached balance on failure.
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
      );
    }
  }

  void updateFromReceipt(double remainingBalance) {
    final previous = state.balanceUsdc;
    state = state.copyWith(
      balanceUsdc: remainingBalance,
      previousBalance: previous,
      isLoading: false,
    );
  }

  void startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) => fetchBalance());
  }

  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  /// Expose for testing — allows setting state directly.
  @visibleForTesting
  void setStateForTest(BalanceState newState) {
    state = newState;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      fetchBalance();
      startPolling();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      stopPolling();
    }
  }

  @override
  void dispose() {
    stopPolling();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
