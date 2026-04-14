import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/deep_link_service.dart';
import '../../features/balance/balance_notifier.dart';
import 'topup_notifier.dart';
import 'topup_state.dart';

class TopUpScreen extends ConsumerStatefulWidget {
  const TopUpScreen({super.key});

  @override
  ConsumerState<TopUpScreen> createState() => _TopUpScreenState();
}

class _TopUpScreenState extends ConsumerState<TopUpScreen> {
  double? _selectedAmount = 10.0;
  String _chain = 'solana';
  final _customController = TextEditingController();
  final _txHashController = TextEditingController();
  String? _customError;
  bool _walletLaunched = false;
  bool _navigated = false;

  @override
  void initState() {
    super.initState();
    _customController.addListener(_onCustomChanged);
    _checkDeepLinkCallback();
  }

  /// If we arrived via a `clude://topup/callback` deep link, consume the
  /// stashed params and resume the confirmation flow.
  void _checkDeepLinkCallback() {
    final params = ref.read(deepLinkServiceProvider).consumeTopupParams();
    if (params == null) return;
    final (intentId, txHash) = params;
    // Schedule after the first frame so the widget tree is built.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(topupNotifierProvider.notifier).resumeFromCallback(intentId, txHash);
    });
  }

  @override
  void dispose() {
    _customController.dispose();
    _txHashController.dispose();
    super.dispose();
  }

  void _onCustomChanged() {
    final text = _customController.text.trim();
    if (text.isEmpty) {
      setState(() {
        _selectedAmount = null;
        _customError = null;
      });
      return;
    }
    final parsed = double.tryParse(text);
    setState(() {
      if (parsed == null || parsed < 1.0) {
        _customError = 'Minimum \$1.00';
        _selectedAmount = null;
      } else {
        _customError = null;
        _selectedAmount = parsed;
      }
    });
  }

  void _selectPreset(double amount) {
    _customController.clear();
    setState(() {
      _selectedAmount = amount;
      _customError = null;
    });
  }

  Future<void> _onCta() async {
    if (_selectedAmount == null) return;
    await ref
        .read(topupNotifierProvider.notifier)
        .createIntent(_selectedAmount!, _chain);
  }

  Future<void> _tryLaunchWallet(String url) async {
    final uri = Uri.parse(url);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      setState(() => _walletLaunched = true);
    } catch (_) {
      setState(() => _walletLaunched = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final topupState = ref.watch(topupNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;

    ref.listen<TopupState>(topupNotifierProvider, (prev, next) {
      // Launch wallet when entering awaitingPayment for Solana.
      if (next is TopupAwaitingPayment &&
          next.chain == 'solana' &&
          next.solanaPayUrl != null &&
          prev is! TopupAwaitingPayment) {
        _tryLaunchWallet(next.solanaPayUrl!);
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('Top Up')),
      body: topupState.map(
        idle: (_) => _buildAmountSelection(colorScheme),
        creatingIntent: (_) => _buildAmountSelection(colorScheme, loading: true),
        awaitingPayment: (s) => _buildAwaitingPayment(s, colorScheme),
        confirmed: (s) => _buildConfirmed(s, colorScheme),
        error: (s) => _buildError(s, colorScheme),
        timedOut: (_) => _buildTimedOut(colorScheme),
      ),
    );
  }

  Widget _buildAmountSelection(ColorScheme colorScheme, {bool loading = false}) {
    final ctaEnabled = _selectedAmount != null && _customError == null && !loading;
    final amountStr = _selectedAmount != null
        ? '\$${_selectedAmount!.toStringAsFixed(2)}'
        : '';
    final ctaLabel = _chain == 'solana'
        ? 'Pay $amountStr with Wallet'
        : "I've sent USDC";
    final balance = ref.watch(balanceNotifierProvider);
    final muted = colorScheme.onSurface.withAlpha(120);
    if (balance.balanceUsdc == null && !balance.isLoading) {
      Future(() => ref.read(balanceNotifierProvider.notifier).fetchBalance());
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // #1 already done externally — Current Balance label
          Text(
            'Current Balance',
            textAlign: TextAlign.center,
            style: TextStyle(color: muted, fontSize: 12),
          ),
          const SizedBox(height: 6),
          // #2: Dollar sign small, amount large
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: '\$',
                  style: TextStyle(
                    fontSize: 16,
                    color: colorScheme.onSurface.withAlpha(180),
                  ),
                ),
                TextSpan(
                  text: balance.balanceUsdc != null
                      ? balance.balanceUsdc!.toStringAsFixed(2)
                      : '—',
                  style: Theme.of(context)
                      .textTheme
                      .headlineLarge
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 28),

          // #3 label
          Text(
            'AMOUNT (USDC)',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: muted,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 10),

          // #4/#5: Equal-width amount buttons
          Row(
            children: [5, 10, 50].map((amount) {
              final isSelected = _selectedAmount == amount.toDouble() &&
                  _customController.text.isEmpty;
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                      right: amount == 50 ? 0 : 8),
                  child: OutlinedButton(
                    onPressed: () => _selectPreset(amount.toDouble()),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      backgroundColor:
                          isSelected ? colorScheme.primary.withAlpha(30) : null,
                      side: BorderSide(
                        color: isSelected
                            ? colorScheme.primary
                            : colorScheme.outline.withAlpha(60),
                        width: isSelected ? 2 : 1,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                    child: Text(
                      '\$$amount',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: isSelected
                            ? colorScheme.primary
                            : colorScheme.onSurface,
                      ),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 12),

          // #6: Custom amount
          TextField(
            controller: _customController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              hintText: 'Custom (min \$1)',
              prefixText: '\$ ',
              errorText: _customError,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            ),
          ),
          const SizedBox(height: 20),

          // #7: Network dropdown
          Text(
            'NETWORK',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: muted,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _chain,
            decoration: InputDecoration(
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
              ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            ),
            items: const [
              DropdownMenuItem(
                value: 'solana',
                child: Row(
                  children: [
                    Text('◆ ', style: TextStyle(fontSize: 12)),
                    Text('Solana (recommended)'),
                  ],
                ),
              ),
              DropdownMenuItem(
                value: 'base',
                child: Row(
                  children: [
                    Text('◆ ', style: TextStyle(fontSize: 12)),
                    Text('Base'),
                  ],
                ),
              ),
            ],
            onChanged: (v) {
              if (v != null) setState(() => _chain = v);
            },
          ),
          const SizedBox(height: 28),

          // #8: Pay button — filled, with icon and amount
          SizedBox(
            height: 52,
            child: FilledButton.icon(
              onPressed: ctaEnabled ? _onCta : null,
              icon: loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.account_balance_wallet_outlined),
              label: Text(
                loading ? '' : ctaLabel,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Sending to: 81MV...iqFu',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colorScheme.onSurface.withAlpha(80),
              fontSize: 11,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Minimum \$1 USDC · Transfers are non-refundable',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colorScheme.onSurface.withAlpha(80),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAwaitingPayment(
      TopupAwaitingPayment s, ColorScheme colorScheme) {
    final isSolana = s.chain == 'solana';

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (isSolana && s.solanaPayUrl != null) ...[
            Center(
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: QrImageView(
                  data: s.solanaPayUrl!,
                  version: QrVersions.auto,
                  size: 220,
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (!_walletLaunched)
              Text(
                'No Solana wallet app installed. Scan the QR code instead.',
                textAlign: TextAlign.center,
                style: TextStyle(color: colorScheme.onSurface.withAlpha(150)),
              ),
          ],
          if (!isSolana) ...[
            Text('Send USDC to:',
                style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            GestureDetector(
              onTap: () =>
                  Clipboard.setData(ClipboardData(text: s.destAddress)),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colorScheme.secondary,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(s.destAddress,
                          style: const TextStyle(fontFamily: 'monospace')),
                    ),
                    const Icon(Icons.copy, size: 16),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _txHashController,
              decoration: const InputDecoration(
                hintText: 'Paste transaction hash',
                labelText: 'Transaction Hash',
              ),
            ),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: _txHashController.text.trim().isNotEmpty
                  ? () => ref
                      .read(topupNotifierProvider.notifier)
                      .confirmBase(s.intentId, _txHashController.text.trim())
                  : null,
              child: const Text('Confirm Payment'),
            ),
          ],
          if (isSolana) ...[
            const SizedBox(height: 16),
            Text(
              'Complete in your wallet',
              style: Theme.of(context).textTheme.titleSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            if (_selectedAmount != null)
              Text(
                '\$${_selectedAmount!.toStringAsFixed(2)} USDC',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colorScheme.onSurface.withAlpha(150),
                  fontSize: 13,
                ),
              ),
            const SizedBox(height: 8),
            const CircularProgressIndicator(),
          ],
          const SizedBox(height: 16),
          TextButton(
            onPressed: () =>
                ref.read(topupNotifierProvider.notifier).cancelPolling(),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }

  Widget _buildConfirmed(TopupConfirmed s, ColorScheme colorScheme) {
    if (!_navigated) {
      _navigated = true;
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) {
          ref.read(topupNotifierProvider.notifier).reset();
          context.go('/chat');
        }
      });
    }

    return Center(
      child: GestureDetector(
        onTap: () {
          ref.read(topupNotifierProvider.notifier).reset();
          context.go('/chat');
        },
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, size: 64, color: colorScheme.primary),
            const SizedBox(height: 16),
            Text('Top-up confirmed!',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text('+\$${s.newBalance.toStringAsFixed(2)} USDC',
                style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 24),
            Text('Tap to continue',
                style: TextStyle(
                    color: colorScheme.onSurface.withAlpha(120),
                    fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _buildError(TopupError s, ColorScheme colorScheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48, color: colorScheme.error),
            const SizedBox(height: 16),
            Text(s.message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () =>
                  ref.read(topupNotifierProvider.notifier).reset(),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTimedOut(ColorScheme colorScheme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.timer_off, size: 48,
                color: colorScheme.onSurface.withAlpha(150)),
            const SizedBox(height: 16),
            const Text(
              'Payment not detected after 3 minutes.\n'
              'If you sent USDC, your balance will update shortly.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () =>
                  ref.read(topupNotifierProvider.notifier).reset(),
              child: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }
}
