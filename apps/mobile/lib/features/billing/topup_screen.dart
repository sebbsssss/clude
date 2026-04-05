import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'topup_notifier.dart';
import 'topup_state.dart';

class TopUpScreen extends ConsumerStatefulWidget {
  const TopUpScreen({super.key});

  @override
  ConsumerState<TopUpScreen> createState() => _TopUpScreenState();
}

class _TopUpScreenState extends ConsumerState<TopUpScreen> {
  double? _selectedAmount;
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
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      setState(() => _walletLaunched = true);
    } else {
      setState(() => _walletLaunched = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final topupState = ref.watch(topupNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;

    // Launch wallet when entering awaitingPayment for Solana.
    ref.listen<TopupState>(topupNotifierProvider, (prev, next) {
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
    final ctaLabel = _chain == 'solana' ? 'Pay with Wallet' : "I've sent USDC";

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Select Amount',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [5, 10, 25, 50].map((amount) {
              final isSelected = _selectedAmount == amount.toDouble() &&
                  _customController.text.isEmpty;
              return OutlinedButton(
                onPressed: () => _selectPreset(amount.toDouble()),
                style: OutlinedButton.styleFrom(
                  backgroundColor:
                      isSelected ? colorScheme.primary.withAlpha(30) : null,
                  side: BorderSide(
                    color: isSelected
                        ? colorScheme.primary
                        : colorScheme.outline,
                  ),
                ),
                child: Text('\$$amount'),
              );
            }).toList(),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _customController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              hintText: 'Custom amount',
              prefixText: '\$ ',
              errorText: _customError,
            ),
          ),
          const SizedBox(height: 16),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'solana', label: Text('Solana')),
              ButtonSegment(value: 'base', label: Text('Base')),
            ],
            selected: {_chain},
            onSelectionChanged: (s) => setState(() => _chain = s.first),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: ctaEnabled ? _onCta : null,
            child: loading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(ctaLabel),
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
        children: [
          if (isSolana && s.solanaPayUrl != null) ...[
            Container(
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
            const Text('Waiting for payment...'),
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
        if (mounted) Navigator.of(context).pop();
      });
    }

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.check_circle, size: 64, color: colorScheme.primary),
          const SizedBox(height: 16),
          Text('Top-up confirmed!',
              style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text('\$${s.newBalance.toStringAsFixed(2)}',
              style: Theme.of(context).textTheme.headlineMedium),
        ],
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
