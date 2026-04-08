import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client_provider.dart';
import '../balance/balance_notifier.dart';
import 'topup_constants.dart';
import 'topup_state.dart';

final topupNotifierProvider =
    StateNotifierProvider<TopupNotifier, TopupState>(
  (ref) => TopupNotifier(ref),
);

class TopupNotifier extends StateNotifier<TopupState> {
  TopupNotifier(this._ref) : super(const TopupState.idle());

  final Ref _ref;
  Timer? _pollTimer;
  int _pollCount = 0;
  static const _pollInterval = Duration(seconds: 3);
  static const _maxPolls = 60;

  Future<void> createIntent(double amount, String chain) async {
    state = const TopupState.creatingIntent();
    try {
      final client = _ref.read(apiClientProvider);
      final intent = await client.createTopupIntent(amount, chain);

      if (intent.destAddress != expectedTreasury) {
        state = const TopupState.error(
          message: 'Payment destination mismatch — contact support',
        );
        return;
      }

      state = TopupState.awaitingPayment(
        intentId: intent.id,
        destAddress: intent.destAddress,
        solanaPayUrl: intent.solanaPayUrl,
        chain: chain,
      );

      _startPolling(intent.id);
    } catch (e) {
      if (!mounted) return;
      state = TopupState.error(message: e.toString());
    }
  }

  Future<void> confirmBase(String intentId, String txHash) async {
    state = const TopupState.creatingIntent();
    try {
      final client = _ref.read(apiClientProvider);
      final confirmation = await client.confirmTopup(txHash, intentId);
      if (!mounted) return;

      state = TopupState.confirmed(newBalance: confirmation.balanceUsdc);
      _ref.read(balanceNotifierProvider.notifier).fetchBalance();
    } catch (e) {
      if (!mounted) return;
      state = TopupState.error(message: e.toString());
    }
  }

  void _startPolling(String intentId) {
    _pollCount = 0;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) async {
      _pollCount++;

      if (_pollCount > _maxPolls) {
        _pollTimer?.cancel();
        _pollTimer = null;
        if (mounted) state = const TopupState.timedOut();
        return;
      }

      try {
        final client = _ref.read(apiClientProvider);
        final status = await client.checkTopupStatus(intentId);
        if (!mounted) return;

        if (status.status == 'confirmed') {
          _pollTimer?.cancel();
          _pollTimer = null;
          state = TopupState.confirmed(
            newBalance: status.amountUsdc ?? 0,
          );
          _ref.read(balanceNotifierProvider.notifier).fetchBalance();
        }
      } catch (_) {
        // Continue polling on error.
      }
    });
  }

  void cancelPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    state = const TopupState.idle();
  }

  void reset() {
    _pollTimer?.cancel();
    _pollTimer = null;
    state = const TopupState.idle();
  }

  @visibleForTesting
  void setStateForTest(TopupState newState) {
    state = newState;
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}
