const app = {
    token: localStorage.getItem('admin_token') || '',
    currentPage: 1,
    currentView: 'dashboard',
    chart: null,
    searchTimeout: null,
    refreshInterval: null,

    init() {
        this.cacheDOM();
        this.bindEvents();
        
        if (this.token) {
            this.showApp();
            this.refreshData();
        }

        this.checkHealth();
        setInterval(() => this.checkHealth(), 30000);
    },

    cacheDOM() {
        this.dom = {
            authOverlay: document.getElementById('auth-overlay'),
            mainApp: document.getElementById('main-app'),
            tokenInput: document.getElementById('admin-token-input'),
            loginBtn: document.getElementById('login-btn'),
            logoutBtn: document.getElementById('logout-btn'),
            navItems: document.querySelectorAll('nav li'),
            views: document.querySelectorAll('.view'),
            viewTitle: document.getElementById('view-title'),
            
            // Dashboard
            statTotal: document.getElementById('stat-total'),
            statSent: document.getElementById('stat-sent'),
            statFailed: document.getElementById('stat-failed'),
            statPending: document.getElementById('stat-pending'),
            recentTable: document.getElementById('recent-table-body'),
            chartCanvas: document.getElementById('stats-chart'),
            
            // History
            historyTable: document.getElementById('history-table-body'),
            filterStatus: document.getElementById('filter-status'),
            historySearch: document.getElementById('history-search'),
            refreshHistory: document.getElementById('refresh-history'),
            exportCsvBtn: document.getElementById('export-csv-btn'),
            resendFailedBtn: document.getElementById('resend-failed-btn'),
            prevPage: document.getElementById('prev-page'),
            nextPage: document.getElementById('next-page'),
            pageInfo: document.getElementById('page-info'),
            autoRefreshToggle: document.getElementById('auto-refresh-toggle'),

            // API Keys
            keysTable: document.getElementById('keys-table-body'),
            createKeyBtn: document.getElementById('create-key-btn'),

            // Settings
            settingsForm: document.getElementById('settings-form'),
            setFollowupDelay: document.getElementById('set-followup-delay'),
            setFollowupMessage: document.getElementById('set-followup-message'),

            // Modal
            modal: document.getElementById('message-modal'),
            modalClose: document.querySelectorAll('.close-modal'),
            modalResendBtn: document.getElementById('modal-resend-btn'),
            
            // Status
            whatsappStatus: document.getElementById('connection-status'),
            toastContainer: document.getElementById('toast-container')
        };
    },

    bindEvents() {
        this.dom.loginBtn.onclick = () => this.login();
        this.dom.logoutBtn.onclick = () => this.logout();
        
        this.dom.navItems.forEach(item => {
            item.onclick = (e) => this.switchView(e.currentTarget.dataset.view);
        });

        this.dom.refreshHistory.onclick = () => this.loadHistory();
        this.dom.resendFailedBtn.onclick = () => this.resendFailed();
        this.dom.filterStatus.onchange = () => {
            this.currentPage = 1;
            this.loadHistory();
        };

        this.dom.historySearch.oninput = () => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => {
                this.currentPage = 1;
                this.loadHistory();
            }, 500);
        };

        this.dom.prevPage.onclick = () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadHistory();
            }
        };

        this.dom.nextPage.onclick = () => {
            this.currentPage++;
            this.loadHistory();
        };

        this.dom.createKeyBtn.onclick = () => this.createKey();
        
        this.dom.settingsForm.onsubmit = (e) => this.saveSettings(e);

        this.dom.exportCsvBtn.onclick = () => this.exportCSV();

        this.dom.autoRefreshToggle.onchange = (e) => this.toggleAutoRefresh(e.target.checked);

        this.dom.modalClose.forEach(btn => {
            btn.onclick = () => this.dom.modal.classList.remove('active');
        });

        window.onclick = (e) => {
            if (e.target === this.dom.modal) this.dom.modal.classList.remove('active');
        };
    },

    async apiCall(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'x-admin-token': this.token,
            ...options.headers
        };

        try {
            const response = await fetch(endpoint, { ...options, headers });
            
            if (response.status === 401) {
                this.logout();
                throw new Error('Sessão expirada ou token inválido');
            }

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Erro na requisição');
            
            return data;
        } catch (err) {
            this.showToast(err.message, 'error');
            throw err;
        }
    },

    login() {
        const token = this.dom.tokenInput.value.trim();
        if (!token) return;
        
        this.token = token;
        localStorage.setItem('admin_token', token);
        this.showApp();
        this.refreshData();
    },

    logout() {
        this.token = '';
        localStorage.removeItem('admin_token');
        this.dom.authOverlay.classList.remove('hidden');
        this.dom.mainApp.classList.add('hidden');
    },

    showApp() {
        this.dom.authOverlay.classList.add('hidden');
        this.dom.mainApp.classList.remove('hidden');
    },

    switchView(viewId) {
        this.currentView = viewId;
        this.dom.views.forEach(v => v.classList.add('hidden'));
        document.getElementById(`${viewId}-view`).classList.remove('hidden');
        
        this.dom.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });

        const titles = {
            dashboard: 'Dashboard',
            history: 'Histórico de Mensagens',
            'api-keys': 'Gerenciar Chaves API',
            settings: 'Configurações'
        };
        this.dom.viewTitle.innerText = titles[viewId];

        this.refreshData();
    },

    async refreshData() {
        if (this.currentView === 'dashboard') this.loadDashboard();
        else if (this.currentView === 'history') this.loadHistory();
        else if (this.currentView === 'api-keys') this.loadApiKeys();
        else if (this.currentView === 'settings') this.loadSettings();
    },

    async checkHealth() {
        try {
            const res = await fetch('/health');
            const data = await res.json();
            
            const badge = this.dom.whatsappStatus;
            badge.className = `status-badge ${data.whatsapp}`;
            badge.querySelector('.text').innerText = `WhatsApp: ${data.whatsapp.charAt(0).toUpperCase() + data.whatsapp.slice(1)}`;
        } catch (e) {
            console.error('Health check failed');
        }
    },

    async loadDashboard() {
        try {
            const stats = await this.apiCall('/admin/stats');
            this.dom.statTotal.innerText = stats.total;
            this.dom.statSent.innerText = stats.sent;
            this.dom.statFailed.innerText = stats.failed;
            this.dom.statPending.innerText = stats.pending;

            const recent = await this.apiCall('/admin/notifications?page_size=5');
            this.renderTable(this.dom.recentTable, recent.items, true);

            const dailyStats = await this.apiCall('/admin/stats/daily');
            this.updateChart(dailyStats);
        } catch (e) {}
    },

    updateChart(data) {
        const ctx = this.dom.chartCanvas.getContext('2d');
        
        const labels = [...new Set(data.map(d => d.date))];
        const sentData = labels.map(l => {
            const entry = data.find(d => d.date === l && d.status === 'sent');
            return entry ? entry.count : 0;
        });
        const failedData = labels.map(l => {
            const entry = data.find(d => d.date === l && d.status === 'failed');
            return entry ? entry.count : 0;
        });

        if (this.chart) {
            this.chart.data.labels = labels;
            this.chart.data.datasets[0].data = sentData;
            this.chart.data.datasets[1].data = failedData;
            this.chart.update();
            return;
        }

        const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#6366f1';
        const errorColor = getComputedStyle(document.documentElement).getPropertyValue('--error').trim() || '#ef4444';

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Enviadas',
                        data: sentData,
                        borderColor: primaryColor,
                        backgroundColor: 'transparent',
                        tension: 0.4,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: primaryColor
                    },
                    {
                        label: 'Falhas',
                        data: failedData,
                        borderColor: errorColor,
                        backgroundColor: 'transparent',
                        tension: 0.4,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: errorColor
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { family: 'Outfit' } }
                    }
                }
            }
        });
    },

    async loadHistory() {
        try {
            const status = this.dom.filterStatus.value;
            const search = this.dom.historySearch.value;
            const data = await this.apiCall(`/admin/notifications?page=${this.currentPage}&status=${status}&search=${encodeURIComponent(search)}`);
            
            this.renderTable(this.dom.historyTable, data.items, false);
            
            this.dom.pageInfo.innerText = `Página ${data.pagination.page} de ${data.pagination.total_pages}`;
            this.dom.prevPage.disabled = !data.pagination.has_prev;
            this.dom.nextPage.disabled = !data.pagination.has_next;
        } catch (e) {}
    },

    async loadApiKeys() {
        try {
            const keys = await this.apiCall('/admin/api-keys');
            this.dom.keysTable.innerHTML = keys.map(key => `
                <tr>
                    <td>#${key.id}</td>
                    <td>${key.label}</td>
                    <td>
                        <span class="badge ${key.is_active ? 'sent' : 'failed'}">
                            ${key.is_active ? 'Ativa' : 'Inativa'}
                        </span>
                    </td>
                    <td>${new Date(key.created_at).toLocaleString('pt-BR')}</td>
                    <td>
                        <div class="action-group" style="display:flex; gap:0.5rem">
                            <button class="btn-action" title="${key.is_active ? 'Desativar' : 'Ativar'}" onclick="app.toggleKey(${key.id})">
                                <i class="fas fa-${key.is_active ? 'toggle-on' : 'toggle-off'}"></i>
                            </button>
                            <button class="btn-action" title="Excluir" onclick="app.deleteKey(${key.id})" style="color:var(--error)">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } catch (e) {}
    },

    async loadSettings() {
        try {
            const settings = await this.apiCall('/admin/settings');
            this.dom.setFollowupDelay.value = settings.followup_delay_minutes;
            this.dom.setFollowupMessage.value = settings.followup_message;
        } catch (e) {}
    },

    toggleAutoRefresh(enabled) {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        
        if (enabled) {
            this.refreshInterval = setInterval(() => {
                this.refreshData();
                console.log('[auto-refresh] Data updated');
            }, 30000); // 30 seconds
            this.showToast('Atualização automática ligada', 'info');
        } else {
            this.showToast('Atualização automática desligada', 'info');
        }
    },

    async exportCSV() {
        try {
            const response = await fetch('/admin/notifications/export', {
                headers: { 'x-admin-token': this.token }
            });
            
            if (!response.ok) throw new Error('Falha ao exportar CSV');
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `notificacoes_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            this.showToast('Exportação concluída!', 'success');
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    },

    async saveSettings(e) {
        e.preventDefault();
        try {
            const body = {
                followup_delay_minutes: this.dom.setFollowupDelay.value,
                followup_message: this.dom.setFollowupMessage.value
            };
            await this.apiCall('/admin/settings', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            this.showToast('Configurações salvas com sucesso!', 'success');
        } catch (e) {}
    },

    async createKey() {
        const label = prompt('Digite um nome/identificador para esta chave (ex: API Site, App Mobile):');
        if (!label) return;

        try {
            const res = await this.apiCall('/admin/api-keys', {
                method: 'POST',
                body: JSON.stringify({ label })
            });
            
            alert(`Chave API criada com sucesso!\n\nVALOR DA CHAVE: ${res.api_key}\n\nIMPORTANTE: Copie agora, pois ela não será exibida novamente por segurança.`);
            this.loadApiKeys();
        } catch (e) {}
    },

    async toggleKey(id) {
        try {
            await this.apiCall(`/admin/api-keys/${id}/toggle`, { method: 'POST' });
            this.loadApiKeys();
        } catch (e) {}
    },

    async deleteKey(id) {
        if (!confirm('Tem certeza que deseja excluir esta chave API? Sistemas usando esta chave perderão o acesso imediatamente.')) return;
        
        try {
            await this.apiCall(`/admin/api-keys/${id}`, { method: 'DELETE' });
            this.loadApiKeys();
        } catch (e) {}
    },

    renderTable(container, items, isCompact) {
        if (!items || items.length === 0) {
            container.innerHTML = '<tr><td colspan="8" style="text-align:center">Nenhuma notificação encontrada</td></tr>';
            return;
        }

        container.innerHTML = items.map(item => `
            <tr onclick="app.showDetails(${item.id})" style="cursor:pointer">
                <td>#${item.id}</td>
                <td>
                    <div class="type-badge">
                        <i class="fas fa-${item.type === 'whatsapp' ? 'whatsapp' : 'envelope'}"></i>
                        ${item.type}
                    </div>
                </td>
                <td>${item.recipient}</td>
                ${!isCompact ? `<td>${item.subject || '-'}</td>` : ''}
                <td><span class="badge ${item.status}">${item.status}</span></td>
                ${!isCompact ? `<td>${item.attempts}</td>` : ''}
                <td>${new Date(item.created_at).toLocaleString('pt-BR')}</td>
                <td>
                    <button class="btn-action" title="Ver detalhes" onclick="event.stopPropagation(); app.showDetails(${item.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-action" title="Reenviar" onclick="event.stopPropagation(); app.resend(${item.id})">
                        <i class="fas fa-redo"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    },

    async showDetails(id) {
        try {
            // Find notification in current list if possible, or fetch from API
            const notification = await this.apiCall(`/admin/notifications/${id}`);
            
            document.getElementById('modal-id').innerText = notification.id;
            document.getElementById('modal-to').innerText = notification.recipient;
            document.getElementById('modal-type').innerText = notification.type.toUpperCase();
            document.getElementById('modal-status').innerHTML = `<span class="badge ${notification.status}">${notification.status}</span>`;
            document.getElementById('modal-date').innerText = new Date(notification.created_at).toLocaleString('pt-BR');
            document.getElementById('modal-subject').innerText = notification.subject || '-';
            document.getElementById('modal-body').innerText = notification.body;
            
            const errorContainer = document.getElementById('modal-error-container');
            if (notification.last_error) {
                errorContainer.classList.remove('hidden');
                document.getElementById('modal-error').innerText = notification.last_error;
            } else {
                errorContainer.classList.add('hidden');
            }

            this.dom.modalResendBtn.onclick = () => {
                this.dom.modal.classList.remove('active');
                this.resend(notification.id);
            };

            this.dom.modal.classList.add('active');
        } catch (e) {}
    },

    async resend(id) {
        if (!confirm(`Deseja reenviar a notificação #${id}?`)) return;
        
        try {
            await this.apiCall(`/admin/notifications/${id}/resend`, { method: 'POST' });
            this.showToast('Notificação agendada para reenvio!', 'success');
            this.refreshData();
        } catch (e) {}
    },

    async resendFailed() {
        if (!confirm('Deseja reenviar TODAS as notificações com falha?')) return;
        
        try {
            const res = await this.apiCall('/admin/notifications/resend-failed', { method: 'POST' });
            this.showToast(`${res.count} notificações agendadas para reenvio!`, 'success');
            this.refreshData();
        } catch (e) {}
    },

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${message}</span>
        `;
        this.dom.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
